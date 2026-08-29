<script lang="ts">
  import { onMount, onDestroy } from 'svelte'

  let {
    open,
    onSend,
    onClose,
  }: {
    open: boolean
    onSend: (text: string, mode: 'paste' | 'type') => void
    onClose: () => void
  } = $props()

  let isListening = $state(false)
  let transcript = $state('')
  let interimTranscript = $state('')
  let errorMsg = $state('')
  let isSupported = $state(true)
  let isBlocked = $state(false)
  let recognition: any = null
  let textareaEl: HTMLTextAreaElement | null = $state(null)

  function initRecognition() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      isSupported = false
      errorMsg = 'Web Speech API is not supported on this browser.'
      return
    }

    try {
      recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = navigator.language || 'en-US'

      recognition.onstart = () => {
        isListening = true
        isBlocked = false
        errorMsg = ''
      }

      recognition.onresult = (event: any) => {
        let finalChunk = ''
        let interimChunk = ''

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i]
          if (res.isFinal) {
            finalChunk += res[0].transcript
          } else {
            interimChunk += res[0].transcript
          }
        }

        if (finalChunk) {
          transcript = (transcript ? transcript + ' ' : '') + finalChunk.trim()
        }
        interimTranscript = interimChunk
      }

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') return
        isListening = false
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          isBlocked = true
          errorMsg = 'Browser mic blocked (HTTP restriction). Tap below to use keyboard mic.'
        } else {
          errorMsg = `Mic error: ${event.error}`
        }
      }

      recognition.onend = () => {
        isListening = false
      }
    } catch (e: any) {
      isSupported = false
      errorMsg = e.message || 'Speech recognition failed to initialize'
    }
  }

  function startListening() {
    if (!recognition) initRecognition()
    if (!recognition) return

    try {
      errorMsg = ''
      isBlocked = false
      recognition.start()
      isListening = true
    } catch (e: any) {
      if (e.name !== 'InvalidStateError') {
        isBlocked = true
        errorMsg = 'Could not access browser mic. Tap below to use keyboard mic.'
      }
    }
  }

  function stopListening() {
    if (recognition && isListening) {
      recognition.stop()
      isListening = false
    }
  }

  function toggleListening() {
    if (isListening) stopListening()
    else startListening()
  }

  function handleSend(mode: 'paste' | 'type') {
    const fullText = (transcript + (interimTranscript ? ' ' + interimTranscript : '')).trim()
    if (fullText) {
      stopListening()
      onSend(fullText, mode)
      transcript = ''
      interimTranscript = ''
      onClose()
    }
  }

  function handleClear() {
    transcript = ''
    interimTranscript = ''
    errorMsg = ''
  }

  $effect(() => {
    if (open) {
      initRecognition()
      setTimeout(() => {
        startListening()
        textareaEl?.focus()
      }, 150)
    } else {
      stopListening()
      transcript = ''
      interimTranscript = ''
      errorMsg = ''
      isBlocked = false
    }
  })

  onDestroy(() => {
    stopListening()
  })
</script>

{#if open}
  <div
    class="voice-scrim"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.target === e.currentTarget && onClose()}
    onkeydown={(e) => e.key === 'Escape' && onClose()}
  >
    <div class="voice-card">
      <div class="voice-header">
        <div class="header-left">
          <span class="mic-status-icon {isListening ? 'pulsing' : ''}">
            {isListening ? '🔴' : '🎙️'}
          </span>
          <h3>{isListening ? 'Listening...' : 'Voice & Text Input'}</h3>
        </div>
        <button class="icon-close" onclick={onClose} aria-label="Close">✕</button>
      </div>

      {#if errorMsg}
        <div class="error-banner">
          <span>{errorMsg}</span>
        </div>
      {/if}

      <div class="textarea-wrapper">
        <textarea
          bind:this={textareaEl}
          bind:value={transcript}
          placeholder="Speak or tap here to use your phone's 🎙️ keyboard mic..."
          rows="4"
        ></textarea>
        {#if interimTranscript}
          <div class="interim-preview">
            <span class="interim-text">... {interimTranscript}</span>
          </div>
        {/if}
      </div>

      <div class="controls-row">
        {#if isSupported && !isBlocked}
          <button
            class="mic-toggle-btn {isListening ? 'recording' : ''}"
            onclick={toggleListening}
          >
            {isListening ? '⏹ Stop Mic' : '🎙️ Start Mic'}
          </button>
        {:else}
          <button
            class="mic-toggle-btn"
            onclick={() => textareaEl?.focus()}
          >
            ⌨ Dictate
          </button>
        {/if}

        <button class="clear-btn" onclick={handleClear} disabled={!transcript && !interimTranscript}>
          Clear
        </button>
      </div>

      <div class="action-buttons">
        <button class="btn secondary" onclick={onClose}>Cancel</button>
        <button
          class="btn type-btn"
          disabled={!transcript && !interimTranscript}
          onclick={() => handleSend('type')}
          title="Type text directly into remote window"
        >
          Type Text ⌨
        </button>
        <button
          class="btn primary"
          disabled={!transcript && !interimTranscript}
          onclick={() => handleSend('paste')}
          title="Instantly paste text into remote clipboard (0ms)"
        >
          📋 Paste (Fast)
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .voice-scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    z-index: 200;
    padding: 12px;
    padding-top: max(12px, env(safe-area-inset-top, 12px));
    touch-action: manipulation;
    overflow-y: auto;
  }
  .voice-card {
    background: #151922;
    border: 1px solid #2d3748;
    border-radius: 14px;
    width: 100%;
    max-width: 440px;
    margin-top: 6px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.9);
  }
  .voice-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mic-status-icon {
    font-size: 18px;
  }
  .mic-status-icon.pulsing {
    animation: pulse 1.2s infinite alternate;
  }
  @keyframes pulse {
    0% {
      opacity: 0.4;
      transform: scale(0.9);
    }
    100% {
      opacity: 1;
      transform: scale(1.15);
    }
  }
  h3 {
    margin: 0;
    font-size: 16px;
    color: #e2e8f0;
  }
  .icon-close {
    background: transparent;
    border: none;
    color: var(--muted);
    font-size: 16px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
  }
  .error-banner {
    background: rgba(229, 62, 62, 0.15);
    border: 1px solid #e53e3e;
    color: #feb2b2;
    font-size: 12px;
    padding: 8px 10px;
    border-radius: 8px;
    line-height: 1.35;
  }
  .textarea-wrapper {
    position: relative;
    display: flex;
    flex-direction: column;
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    background: #0d1017;
    border: 1px solid #2d3748;
    border-radius: 8px;
    color: #f7fafc;
    font-size: 15px;
    line-height: 1.4;
    padding: 10px;
    resize: none;
    font-family: inherit;
  }
  textarea:focus {
    outline: none;
    border-color: #3182ce;
  }
  .interim-preview {
    margin-top: 4px;
    font-size: 12px;
    color: #90cdf4;
    font-style: italic;
  }
  .controls-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
  }
  .mic-toggle-btn {
    background: #1e2634;
    color: #90cdf4;
    border: 1px solid #2b6cb0;
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  .mic-toggle-btn.recording {
    background: #9b2c2c;
    border-color: #fc8181;
    color: #fff;
  }
  .clear-btn {
    background: transparent;
    border: 1px solid #4a5568;
    color: #a0aec0;
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .clear-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .action-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  .btn {
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn.secondary {
    background: #1c222d;
    border-color: #2d3748;
    color: #cbd5e0;
  }
  .btn.type-btn {
    background: #1c2738;
    border-color: #2b6cb0;
    color: #90cdf4;
  }
  .btn.primary {
    background: #2b6cb0;
    border-color: #63b3ed;
    color: #fff;
    font-weight: 600;
  }
</style>
