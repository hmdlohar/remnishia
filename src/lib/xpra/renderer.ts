/**
 * Canvas renderer for Xpra draw packets.
 * Handles rgb32, jpeg, png, webp, and scroll drawing with offscreen
 * double-buffering, decode pacing, and requestAnimationFrame blitting.
 */

import { inflateZlib } from './protocol'
import { asStr, type BencodeValue } from './bencode'

// spec-accurate (w3.org/WebCodecs) but missing from TS lib.dom: decoder-side
// avc config, required to select Annex-B parsing for in-band SPS/PPS streams
declare global {
  interface AvcDecoderConfig {
    format?: 'annexb' | 'avc'
  }
  interface VideoDecoderConfig {
    avc?: AvcDecoderConfig
  }
}

export interface DrawPacket {
  wid: number
  x: number
  y: number
  w: number
  h: number
  coding: string
  data: Uint8Array | unknown[]
  packetSequence: number
  rowstride: number
  options: Record<string, unknown>
}

export type DrawCallback = (decodeTimeUs: number, errorMsg?: string) => void

export interface RenderStats {
  fps: number
  avgDecodeMs: number
  queuedFrames: number
  totalPaints: number
}

interface QueuedDraw {
  packet: DrawPacket
  startTime: number
  onComplete: DrawCallback
}

/**
 * Per-window h264 stream state. The bitstream is Annex-B (verified against
 * xpra 3.1.5: start codes 00 00 00 01, SPS/PPS in-band on every IDR) so the
 * decoder is configured without an avcC description.
 *
 * Streaming decode: frames are fed via decode() and painted from the output
 * callback — flush() is only allowed at stream end because Chrome's decoder
 * requires a key frame after a flush (verified experimentally), which would
 * break every P frame.
 */
interface VideoStream {
  decoder: VideoDecoder
  nextTimestampUs: number
  errored: boolean
  /** FIFO of frames awaiting decoded output (draw target + resolver). */
  waiting: Array<{ x: number; y: number; w: number; h: number; resolve: () => void }>
}

export class XpraRenderer {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private offscreenCanvas: HTMLCanvasElement | OffscreenCanvas | null = null
  private offscreenCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null

  private width = 0
  private height = 0
  private drawQueue: QueuedDraw[] = []
  private painting = false
  private paintTimeout: ReturnType<typeof setTimeout> | null = null
  private redrawPending = false
  private videoStreams = new Map<number, VideoStream>()

  // Performance telemetry
  private frameCount = 0
  private lastFpsCalc = performance.now()
  private currentFps = 0
  private totalDecodeMs = 0
  private decodeSamples = 0
  private totalPaints = 0

  onStats?: (stats: RenderStats) => void

  attachCanvas(canvas: HTMLCanvasElement) {
    if (this.canvas === canvas && this.ctx) return
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })
    if (!this.offscreenCanvas) {
      this.initOffscreen()
    }
    if (this.width > 0 && this.height > 0) {
      if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
        this.canvas.width = this.width
        this.canvas.height = this.height
      }
      this.requestRedraw(true)
    }
  }

  detachCanvas() {
    this.canvas = null
    this.ctx = null
    this.offscreenCanvas = null
    this.offscreenCtx = null
    this.drawQueue = []
    this.painting = false
    for (const wid of [...this.videoStreams.keys()]) this.closeVideo(wid)
    if (this.paintTimeout) {
      clearTimeout(this.paintTimeout)
      this.paintTimeout = null
    }
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    if (this.width === width && this.height === height) {
      // Dimensions did not change — do not re-assign canvas.width as that clears pixels!
      return
    }

    const prevOffscreen = this.offscreenCanvas
    const prevW = this.width
    const prevH = this.height

    this.width = width
    this.height = height

    if (this.canvas) {
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width
        this.canvas.height = height
      }
    }

    this.initOffscreen()

    // Preserve buffer across resize so screen does not flash black
    if (prevOffscreen && this.offscreenCtx && prevW > 0 && prevH > 0) {
      try {
        this.offscreenCtx.drawImage(prevOffscreen as CanvasImageSource, 0, 0)
      } catch {
        // Ignored
      }
    }

    this.requestRedraw(true)
  }

  private initOffscreen() {
    if (typeof OffscreenCanvas !== 'undefined') {
      this.offscreenCanvas = new OffscreenCanvas(this.width || 1, this.height || 1)
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { alpha: false })
    } else if (typeof document !== 'undefined') {
      const c = document.createElement('canvas')
      c.width = this.width || 1
      c.height = this.height || 1
      this.offscreenCanvas = c
      this.offscreenCtx = c.getContext('2d', { alpha: false })
    }
  }

  queueDraw(packet: DrawPacket, onComplete: DrawCallback) {
    const startTime = performance.now()
    this.drawQueue.push({ packet, startTime, onComplete })
    this.processQueue()
  }

  private processQueue() {
    if (this.painting || this.drawQueue.length === 0) return

    const item = this.drawQueue.shift()
    if (!item) return

    this.painting = true

    // Safety watchdog: abort single frame after 2000ms if image decode hangs
    this.paintTimeout = setTimeout(() => {
      if (this.painting) {
        this.painting = false
        item.onComplete(-1, 'draw decode timed out')
        this.processQueue()
      }
    }, 2000)

    this.paintItem(item.packet)
      .then(() => {
        if (this.paintTimeout) {
          clearTimeout(this.paintTimeout)
          this.paintTimeout = null
        }
        this.painting = false
        const durationMs = performance.now() - item.startTime
        const decodeTimeUs = Math.max(0, Math.round(1000 * durationMs))
        this.recordDecodeSample(durationMs)
        const flush = Boolean(item.packet.options && item.packet.options['flush'])
        this.requestRedraw(flush)
        item.onComplete(decodeTimeUs)
        this.processQueue()
      })
      .catch((err: unknown) => {
        if (this.paintTimeout) {
          clearTimeout(this.paintTimeout)
          this.paintTimeout = null
        }
        this.painting = false
        const msg = err instanceof Error ? err.message : String(err)
        this.requestRedraw(false)
        item.onComplete(-1, msg)
        this.processQueue()
      })
  }

  private recordDecodeSample(ms: number) {
    this.totalPaints++
    this.totalDecodeMs += ms
    this.decodeSamples++
  }

  private updateFps() {
    this.frameCount++
    const now = performance.now()
    if (now - this.lastFpsCalc >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsCalc))
      this.frameCount = 0
      this.lastFpsCalc = now

      const avgMs = this.decodeSamples > 0 ? this.totalDecodeMs / this.decodeSamples : 0
      this.totalDecodeMs = 0
      this.decodeSamples = 0

      this.onStats?.({
        fps: this.currentFps,
        avgDecodeMs: Math.round(avgMs * 10) / 10,
        queuedFrames: this.drawQueue.length,
        totalPaints: this.totalPaints,
      })
    }
  }

  private async paintItem(p: DrawPacket): Promise<void> {
    const { x, y, w, h, coding, data, rowstride, options } = p
    const requiredW = x + w
    const requiredH = y + h
    if (requiredW > this.width || requiredH > this.height) {
      this.resize(Math.max(this.width, requiredW), Math.max(this.height, requiredH))
    }
    if (!this.offscreenCtx) return

    switch (coding) {
      case 'rgb32':
      case 'rgb': {
        if (!(data instanceof Uint8Array)) {
          throw new Error('rgb32 expected Uint8Array data')
        }
        let rawData = data
        if (options && typeof options['zlib'] === 'number' && options['zlib'] > 0) {
          rawData = await inflateZlib(data)
        }

        const img = this.offscreenCtx.createImageData(w, h)
        const targetStride = w * 4
        if (rowstride > targetStride) {
          for (let row = 0; row < h; row++) {
            const line = rawData.subarray(row * rowstride, row * rowstride + targetStride)
            img.data.set(line, row * targetStride)
          }
        } else {
          img.data.set(rawData.subarray(0, w * h * 4))
        }
        this.offscreenCtx.putImageData(img, x, y)
        break
      }

      case 'jpeg':
      case 'png':
      case 'webp': {
        if (!(data instanceof Uint8Array)) {
          throw new Error(`${coding} expected Uint8Array data`)
        }
        const blob = new Blob([data as unknown as BlobPart], { type: `image/${coding}` })
        if (typeof createImageBitmap !== 'undefined') {
          const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' })
          this.offscreenCtx.drawImage(bitmap, x, y, w, h)
          bitmap.close()
        } else if (typeof Image !== 'undefined') {
          await new Promise<void>((resolve, reject) => {
            const img = new Image()
            const url = URL.createObjectURL(blob)
            img.onload = () => {
              this.offscreenCtx?.drawImage(img, x, y, w, h)
              URL.revokeObjectURL(url)
              resolve()
            }
            img.onerror = () => {
              URL.revokeObjectURL(url)
              reject(new Error(`Failed to load ${coding} image`))
            }
            img.src = url
          })
        }
        break
      }

      case 'h264': {
        if (!(data instanceof Uint8Array)) {
          throw new Error('h264 expected Uint8Array data')
        }
        await this.paintH264(p, data)
        break
      }

      case 'scroll': {
        if (Array.isArray(data)) {
          for (const scrollEntry of data) {
            if (Array.isArray(scrollEntry) && scrollEntry.length >= 6) {
              const [sx, sy, sw, sh, dx, dy] = scrollEntry as number[]
              if (this.offscreenCanvas) {
                this.offscreenCtx.drawImage(
                  this.offscreenCanvas as CanvasImageSource,
                  sx,
                  sy,
                  sw,
                  sh,
                  sx + dx,
                  sy + dy,
                  sw,
                  sh,
                )
              }
            }
          }
        }
        break
      }

      default:
        throw new Error(`unsupported coding: ${coding}`)
    }
  }

  /**
   * Feed one h264 frame (Annex-B) to the per-window WebCodecs decoder and
   * wait for its decoded output to be painted (or a watchdog timeout). The
   * draw queue serializes calls, so decode order matches wire order —
   * required for P-frame referencing.
   */
  private async paintH264(p: DrawPacket, data: Uint8Array): Promise<void> {
    const { wid, x, y, w, h, options } = p
    const isKey = asStr(options['type'] as BencodeValue) === 'IDR' || options['frame'] === 0
    let stream = this.videoStreams.get(wid)

    // (re)start stream on keyframes only — a delta with no live decoder is
    // unrecoverable until the server sends the next IDR
    if (!stream || stream.errored || stream.decoder.state === 'closed') {
      if (!isKey) throw new Error('h264 delta before keyframe')
      if (stream) this.closeVideo(wid)
      stream = this.openDecoder(wid, data)
      this.videoStreams.set(wid, stream)
    }
    if (stream.decoder.state !== 'configured') {
      throw new Error('h264 decoder not configured')
    }

    // server marks frames the client should not paint (stale encoder output)
    if (options['paint'] !== false) {
      const done = new Promise<void>((resolve) => {
        stream!.waiting.push({ x, y, w, h, resolve })
      })
      try {
        stream.decoder.decode(
          new EncodedVideoChunk({
            type: isKey ? 'key' : 'delta',
            timestamp: stream.nextTimestampUs,
            data: data as Uint8Array<ArrayBuffer>,
          }),
        )
      } catch (e) {
        // e.g. "key frame required": decoder state lost — rebuild on next IDR
        stream.errored = true
        throw e
      }
      stream.nextTimestampUs += 40000 // 25fps nominal; real pts are not monotonic across IDRs

      // the output callback paints + resolves; baseline H264 has no B-frames
      // so output order matches input, but the decoder may buffer briefly —
      // watchdog keeps the draw queue (and damage acks) moving
      await Promise.race([done, new Promise((r) => setTimeout(r, 100))])
      if (!this.offscreenCtx) return
      this.requestRedraw(false)
    }
  }

  private openDecoder(wid: number, keyframeData: Uint8Array): VideoStream {
    const stream: VideoStream = {
      decoder: null as unknown as VideoDecoder,
      nextTimestampUs: 0,
      errored: false,
      waiting: [],
    }
    const decoder = new VideoDecoder({
      output: (frame) => {
        const job = stream.waiting.shift()
        const ctx = this.offscreenCtx
        if (job && ctx) {
          ctx.drawImage(frame, job.x, job.y, job.w, job.h)
        }
        frame.close()
        job?.resolve()
      },
      error: () => {
        // mark dead; next keyframe rebuilds the stream via paintH264
        stream.errored = true
      },
    })
    const codec = parseAvcCodecString(keyframeData) ?? 'avc1.42C028'
    decoder.configure({
      codec,
      avc: { format: 'annexb' },
      optimizeForLatency: true,
    })
    stream.decoder = decoder
    return stream
  }

  /** Drop a window's video stream (server 'eos', window close, canvas detach). */
  closeVideo(wid: number) {
    const stream = this.videoStreams.get(wid)
    if (!stream) return
    this.videoStreams.delete(wid)
    for (const job of stream.waiting) job.resolve()
    stream.waiting.length = 0
    if (stream.decoder.state === 'configured') {
      stream.decoder.close()
    }
  }

  requestRedraw(flush = false) {
    if (!this.canvas || !this.ctx || !this.offscreenCanvas) return

    if (flush) {
      this.ctx.drawImage(this.offscreenCanvas as CanvasImageSource, 0, 0)
      this.updateFps()
      return
    }

    if (!this.redrawPending) {
      this.redrawPending = true
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => {
          this.redrawPending = false
          if (this.ctx && this.offscreenCanvas) {
            this.ctx.drawImage(this.offscreenCanvas as CanvasImageSource, 0, 0)
            this.updateFps()
          }
        })
      } else {
        this.redrawPending = false
        this.ctx.drawImage(this.offscreenCanvas as CanvasImageSource, 0, 0)
        this.updateFps()
      }
    }
  }
}

/**
 * Build a WebCodecs codec string ("avc1.PPCCLL") from the in-band SPS NAL of
 * an Annex-B stream: bytes after the NAL header are profile_idc, constraint
 * flags, level_idc. Verified live: 67 42 c0 28 -> "avc1.42C028".
 */
function parseAvcCodecString(data: Uint8Array): string | null {
  for (let i = 0; i < data.length - 4; i++) {
    const isStart3 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1
    const isStart4 = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1
    if (!isStart3 && !isStart4) continue
    const nalHdr = isStart4 ? i + 4 : i + 3
    if ((data[nalHdr] & 0x1f) !== 7) continue
    if (nalHdr + 3 >= data.length) continue
    const hex = (n: number) => data[nalHdr + n].toString(16).toUpperCase().padStart(2, '0')
    return `avc1.${hex(1)}${hex(2)}${hex(3)}`
  }
  return null
}
