<script lang="ts">
  import { translateKeyEvent } from '../lib/xpra/keycodes'

  let {
    onKeyPress,
    onKeyAction,
    onVoiceInput,
  }: {
    onKeyPress: (keyname: string, modifiers: string[], keyval?: number, str?: string) => void
    onKeyAction: (keyname: string, pressed: boolean, modifiers: string[], keyval?: number, str?: string) => void
    onVoiceInput?: () => void
  } = $props()

  type ModKey = 'control' | 'alt' | 'shift' | 'meta'
  type ModState = 'off' | 'latched' | 'locked'

  let ctrlState = $state<ModState>('off')
  let altState = $state<ModState>('off')
  let shiftState = $state<ModState>('off')
  let metaState = $state<ModState>('off')

  let layer = $state<'alpha' | 'sym'>('alpha')
  let inputBridgeEl: HTMLInputElement | null = $state(null)

  function activeModifiers(): string[] {
    const mods: string[] = []
    if (ctrlState !== 'off') mods.push('control')
    if (altState !== 'off') mods.push('alt')
    if (shiftState !== 'off') mods.push('shift')
    if (metaState !== 'off') mods.push('meta')
    return mods
  }

  function consumeLatches() {
    if (ctrlState === 'latched') ctrlState = 'off'
    if (altState === 'latched') altState = 'off'
    if (shiftState === 'latched') shiftState = 'off'
    if (metaState === 'latched') metaState = 'off'
  }

  function toggleModifier(mod: ModKey) {
    if (mod === 'control') {
      ctrlState = ctrlState === 'off' ? 'latched' : ctrlState === 'latched' ? 'locked' : 'off'
    } else if (mod === 'alt') {
      altState = altState === 'off' ? 'latched' : altState === 'latched' ? 'locked' : 'off'
    } else if (mod === 'shift') {
      shiftState = shiftState === 'off' ? 'latched' : shiftState === 'latched' ? 'locked' : 'off'
    } else if (mod === 'meta') {
      metaState = metaState === 'off' ? 'latched' : metaState === 'latched' ? 'locked' : 'off'
    }
  }

  function pressKey(key: string, customKeyname?: string, customKeyval?: number) {
    const mods = activeModifiers()
    const info = translateKeyEvent({ key })
    const kn = customKeyname ?? info.keyname
    const kv = customKeyval ?? info.keyval
    const s = info.str || (key.length === 1 ? key : '')

    onKeyPress(kn, mods, kv, s)
    consumeLatches()
  }

  function sendMacro(macro: string) {
    if (macro === 'ctrl+c') onKeyPress('c', ['control'], 'c'.charCodeAt(0), 'c')
    else if (macro === 'ctrl+v') onKeyPress('v', ['control'], 'v'.charCodeAt(0), 'v')
    else if (macro === 'ctrl+z') onKeyPress('z', ['control'], 'z'.charCodeAt(0), 'z')
    else if (macro === 'ctrl+d') onKeyPress('d', ['control'], 'd'.charCodeAt(0), 'd')
    else if (macro === 'ctrl+l') onKeyPress('l', ['control'], 'l'.charCodeAt(0), 'l')
  }

  function handleBridgeInput(e: Event) {
    const target = e.target as HTMLInputElement
    const val = target.value
    if (val) {
      for (const ch of val) {
        pressKey(ch)
      }
      target.value = ''
    }
  }

  function handleBridgeKeyDown(e: KeyboardEvent) {
    if (e.key === 'Backspace') {
      pressKey('Backspace')
      e.preventDefault()
    } else if (e.key === 'Enter') {
      pressKey('Enter')
      e.preventDefault()
    }
  }

  const alphaRows = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
  ]

  // Symbols on left, Mobile phone sequence Numpad (123 -> 456 -> 789 -> 0) on right
  const symRows = [
    { syms: ['!', '@', '#', '$', '%'], numpad: ['1', '2', '3', '/'] },
    { syms: ['^', '&', '*', '(', ')'], numpad: ['4', '5', '6', '*'] },
    { syms: ['[', ']', '{', '}', '\\'], numpad: ['7', '8', '9', '-'] },
    { syms: ["'", '"', '<', '>', '?'], numpad: ['0', '.', '=', '+'] },
  ]
</script>

<div class="virtual-keyboard">
  <!-- Top Macro & Nav Strip -->
  <div class="row strip">
    <button class="btn fn" onclick={() => pressKey('Escape')}>Esc</button>
    <button class="btn fn" onclick={() => pressKey('Tab')}>Tab</button>
    <button class="btn fn" onclick={() => sendMacro('ctrl+c')}>^C</button>
    <button class="btn fn" onclick={() => sendMacro('ctrl+v')}>^V</button>
    <button class="btn fn" onclick={() => sendMacro('ctrl+z')}>^Z</button>
    <button class="btn fn" onclick={() => sendMacro('ctrl+d')}>^D</button>
    <button class="btn fn arrow" onclick={() => pressKey('ArrowUp')}>▲</button>
    <button class="btn fn arrow" onclick={() => pressKey('ArrowDown')}>▼</button>
    <button class="btn fn arrow" onclick={() => pressKey('ArrowLeft')}>◄</button>
    <button class="btn fn arrow" onclick={() => pressKey('ArrowRight')}>►</button>
    {#if onVoiceInput}
      <button class="btn fn voice-btn" onclick={onVoiceInput} title="Voice Input">🎙️</button>
    {/if}
    <button class="btn fn bridge-btn" onclick={() => inputBridgeEl?.focus()}>⌨</button>
  </div>

  <!-- Hidden native input bridge -->
  <input
    bind:this={inputBridgeEl}
    type="text"
    class="bridge-input"
    autocomplete="off"
    autocorrect="off"
    autocapitalize="off"
    spellcheck="false"
    oninput={handleBridgeInput}
    onkeydown={handleBridgeKeyDown}
  />

  <!-- Modifier Bar (4 Modifiers spanning evenly across the row) -->
  <div class="row mod-row">
    <button class="btn mod {ctrlState}" onclick={() => toggleModifier('control')}>
      Ctrl {ctrlState === 'locked' ? '🔒' : ctrlState === 'latched' ? '•' : ''}
    </button>
    <button class="btn mod {altState}" onclick={() => toggleModifier('alt')}>
      Alt {altState === 'locked' ? '🔒' : altState === 'latched' ? '•' : ''}
    </button>
    <button class="btn mod {shiftState}" onclick={() => toggleModifier('shift')}>
      Shift {shiftState === 'locked' ? '🔒' : shiftState === 'latched' ? '•' : ''}
    </button>
    <button class="btn mod {metaState}" onclick={() => toggleModifier('meta')}>
      Super {metaState === 'locked' ? '🔒' : metaState === 'latched' ? '•' : ''}
    </button>
  </div>

  <!-- Alpha Layer (Primary ABC view) -->
  {#if layer === 'alpha'}
    {#each alphaRows as row, i}
      <div class="row">
        {#if i === 2}
          <button class="btn mod {shiftState}" onclick={() => toggleModifier('shift')}>⇧</button>
        {/if}
        {#each row as key}
          <button class="btn key" onclick={() => pressKey(shiftState !== 'off' ? key.toUpperCase() : key)}>
            {shiftState !== 'off' ? key.toUpperCase() : key}
          </button>
        {/each}
        {#if i === 2}
          <button class="btn act" onclick={() => pressKey('Backspace')}>⌫</button>
        {/if}
      </div>
    {/each}

    <!-- Bottom Space Row with ?123 Mode Switcher at Bottom-Left -->
    <div class="row space-row">
      <button class="btn mode-switch-btn" onclick={() => (layer = 'sym')}>?123</button>
      <button class="btn key sym-char" onclick={() => pressKey('/')}>/</button>
      <button class="btn key sym-char" onclick={() => pressKey('-')}>-</button>
      <button class="btn key comma-btn" onclick={() => pressKey(',')}>,</button>
      <button class="btn space-btn" onclick={() => pressKey(' ')}>Space</button>
      <button class="btn key dot-btn" onclick={() => pressKey('.')}>.</button>
      <button class="btn return-btn" onclick={() => pressKey('Enter')}>↵ Return</button>
    </div>
  {/if}

  <!-- Sym & Numpad Split Layer (123 view with ABC switcher at Bottom-Left) -->
  {#if layer === 'sym'}
    {#each symRows as row}
      <div class="row sym-split-row">
        <!-- Left Side: Symbols Block -->
        <div class="sym-block">
          {#each row.syms as sym}
            <button class="btn key sym-key" onclick={() => pressKey(sym)}>{sym}</button>
          {/each}
        </div>

        <div class="divider"></div>

        <!-- Right Side: Numpad Block -->
        <div class="numpad-block">
          {#each row.numpad as num}
            <button
              class="btn key numpad-key {['+', '-', '*', '/', '='].includes(num) ? 'num-op' : ''}"
              onclick={() => pressKey(num)}
            >
              {num}
            </button>
          {/each}
        </div>
      </div>
    {/each}

    <!-- Bottom Row with ABC Switcher at Bottom-Left -->
    <div class="row space-row">
      <button class="btn mode-switch-btn active" onclick={() => (layer = 'alpha')}>ABC</button>
      <button class="btn key sym-char" onclick={() => pressKey(';')}>;</button>
      <button class="btn key sym-char" onclick={() => pressKey(':')}>:</button>
      <button class="btn space-btn" onclick={() => pressKey(' ')}>Space</button>
      <button class="btn act" onclick={() => pressKey('Backspace')}>⌫</button>
      <button class="btn return-btn" onclick={() => pressKey('Enter')}>↵ Return</button>
    </div>
  {/if}
</div>

<style>
  .virtual-keyboard {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: #11141a;
    padding: 6px;
    border-radius: 10px;
    border: 1px solid var(--border);
    user-select: none;
    touch-action: manipulation;
  }
  .row {
    display: flex;
    gap: 4px;
    justify-content: center;
    width: 100%;
  }
  .strip {
    overflow-x: auto;
    justify-content: flex-start;
    padding-bottom: 2px;
  }
  .btn {
    flex: 1;
    min-width: 28px;
    height: 36px;
    padding: 0 4px;
    font-size: 14px;
    font-weight: 500;
    background: #1c222d;
    color: #e2e8f0;
    border: 1px solid #2d3748;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .btn:active {
    background: #3182ce;
    color: #fff;
  }
  .btn.fn {
    font-size: 11px;
    height: 28px;
    min-width: 32px;
    flex: 0 0 auto;
    background: #171c24;
  }
  .btn.arrow {
    font-size: 10px;
    min-width: 28px;
  }
  .btn.bridge-btn {
    font-size: 14px;
    background: #232c3b;
    min-width: 34px;
  }
  .btn.mod {
    font-size: 12px;
    background: #1e2634;
  }
  .btn.mod.latched {
    background: #2b6cb0;
    border-color: #63b3ed;
    color: #fff;
  }
  .btn.mod.locked {
    background: #9b2c2c;
    border-color: #fc8181;
    color: #fff;
  }
  .btn.mode-switch-btn {
    flex: 1.3;
    background: #2d3748;
    font-weight: 600;
    font-size: 12px;
    color: #90cdf4;
  }
  .btn.mode-switch-btn.active {
    background: #2b6cb0;
    color: #fff;
  }
  .btn.act {
    flex: 1.5;
    background: #2d3748;
  }
  .btn.sym-char {
    flex: 0.8;
  }
  .btn.comma-btn,
  .btn.dot-btn {
    flex: 1.1;
    font-size: 16px;
    font-weight: 600;
    background: #202836;
  }
  .space-btn {
    flex: 3.5;
  }
  .return-btn {
    flex: 2.2;
    background: #2b6cb0;
    color: #fff;
    font-size: 12px;
  }
  .bridge-input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
    width: 0;
    height: 0;
  }

  /* Split Symbols on Left, Numpad on Right */
  .sym-split-row {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .sym-block {
    display: flex;
    flex: 1.1;
    gap: 3px;
  }
  .sym-key {
    background: #18202c;
    color: #90cdf4;
    font-size: 13px;
  }
  .divider {
    width: 1px;
    height: 32px;
    background: #2d3748;
    margin: 0 1px;
  }
  .numpad-block {
    display: flex;
    flex: 1;
    gap: 3px;
  }
  .numpad-key {
    background: #202938;
    color: #f7fafc;
    font-weight: 600;
    font-size: 15px;
  }
  .numpad-key.num-op {
    background: #1a2230;
    color: #cbd5e0;
    font-size: 14px;
  }
</style>
