/**
 * Canvas renderer for Xpra draw packets.
 * Handles rgb32, jpeg, png, webp, and scroll drawing with offscreen
 * double-buffering, decode pacing, and requestAnimationFrame blitting.
 */

import { inflateZlib } from './protocol'

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

  // Performance telemetry
  private frameCount = 0
  private lastFpsCalc = performance.now()
  private currentFps = 0
  private totalDecodeMs = 0
  private decodeSamples = 0
  private totalPaints = 0

  onStats?: (stats: RenderStats) => void

  attachCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })
    this.initOffscreen()
    if (this.width > 0 && this.height > 0) {
      this.resize(this.width, this.height)
    }
  }

  detachCanvas() {
    this.canvas = null
    this.ctx = null
    this.offscreenCanvas = null
    this.offscreenCtx = null
    this.drawQueue = []
    this.painting = false
    if (this.paintTimeout) {
      clearTimeout(this.paintTimeout)
      this.paintTimeout = null
    }
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return
    this.width = width
    this.height = height

    if (this.canvas) {
      this.canvas.width = width
      this.canvas.height = height
    }
    if (this.offscreenCanvas) {
      this.offscreenCanvas.width = width
      this.offscreenCanvas.height = height
    }
  }

  private initOffscreen() {
    if (typeof OffscreenCanvas !== 'undefined') {
      this.offscreenCanvas = new OffscreenCanvas(this.width || 1, this.height || 1)
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { alpha: false, desynchronized: true })
    } else if (typeof document !== 'undefined') {
      const c = document.createElement('canvas')
      c.width = this.width || 1
      c.height = this.height || 1
      this.offscreenCanvas = c
      this.offscreenCtx = c.getContext('2d', { alpha: false, desynchronized: true })
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
    if (!this.offscreenCtx) return

    const { x, y, w, h, coding, data, rowstride, options } = p

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
