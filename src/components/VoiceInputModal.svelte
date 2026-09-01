<script lang="ts">
  let {
    open,
    onSend,
    onClose,
  }: {
    open: boolean
    onSend: (text: string, mode: 'paste' | 'type') => void
    onClose: () => void
  } = $props()

  let transcript = $state('')
  let textareaEl: HTMLTextAreaElement | null = $state(null)

  function handleSend(mode: 'paste' | 'type') {
    const fullText = transcript.trim()
    if (fullText) {
      onSend(fullText, mode)
      transcript = ''
      onClose()
    }
  }

  function handleClear() {
    transcript = ''
  }

  $effect(() => {
    if (open) {
      setTimeout(() => textareaEl?.focus(), 50)
    } else {
      transcript = ''
    }
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
          <span class="mic-status-icon">🎙️</span>
          <h3>Voice & Text Input</h3>
        </div>
        <button class="icon-close" onclick={onClose} aria-label="Close">✕</button>
      </div>

      <div class="hint-banner">
        <span>Tap the 🎙️ key on your phone keyboard to dictate, or type below.</span>
      </div>

      <div class="textarea-wrapper">
        <textarea
          bind:this={textareaEl}
          bind:value={transcript}
          placeholder="Dictate with your phone keyboard's mic, or type here..."
          rows="4"
        ></textarea>
      </div>

      <div class="controls-row">
        <button class="clear-btn" onclick={handleClear} disabled={!transcript}>
          Clear
        </button>
      </div>

      <div class="action-buttons">
        <button class="btn secondary" onclick={onClose}>Cancel</button>
        <button
          class="btn type-btn"
          disabled={!transcript}
          onclick={() => handleSend('type')}
          title="Type text directly into remote window"
        >
          Type Text ⌨
        </button>
        <button
          class="btn primary"
          disabled={!transcript}
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
  .hint-banner {
    background: rgba(49, 130, 206, 0.12);
    border: 1px solid #2b6cb0;
    color: #90cdf4;
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
  .controls-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
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
