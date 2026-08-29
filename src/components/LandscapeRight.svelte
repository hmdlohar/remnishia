<script lang="ts">
  interface KeyItem {
    label: string
    key: string
    keyval?: number
    special?: boolean
    enter?: boolean
    arrow?: boolean
  }

  let {
    onKeyPress,
    onMouseButton,
    onZoomFit,
    isZoomFit = true,
    onVoiceInput,
    onToggleFullscreen,
    isFullscreen = false,
    onOpenSettings,
    onToggleLock,
    isSymbols = $bindable(false),
    ctrlState = $bindable<'off' | 'latched' | 'locked'>('off'),
    altState = $bindable<'off' | 'latched' | 'locked'>('off'),
    shiftState = $bindable<'off' | 'latched' | 'locked'>('off'),
    metaState = $bindable<'off' | 'latched' | 'locked'>('off'),
  }: {
    onKeyPress: (keyname: string, modifiers: string[], keyval?: number, str?: string) => void
    onMouseButton: (button: number) => void
    onZoomFit: () => void
    isZoomFit?: boolean
    onVoiceInput: () => void
    onToggleFullscreen: () => void
    isFullscreen?: boolean
    onOpenSettings?: () => void
    onToggleLock?: () => void
    isSymbols?: boolean
    ctrlState?: 'off' | 'latched' | 'locked'
    altState?: 'off' | 'latched' | 'locked'
    shiftState?: 'off' | 'latched' | 'locked'
    metaState?: 'off' | 'latched' | 'locked'
  } = $props()

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

  function pressKey(keyname: string, keyval = 0, str = '') {
    const mods = activeModifiers()
    let finalKey = keyname
    let finalStr = str || keyname

    // If shift is active and it's a letter
    if (shiftState !== 'off' && keyname.length === 1 && keyname >= 'a' && keyname <= 'z') {
      finalKey = keyname.toUpperCase()
      finalStr = finalKey
    }

    onKeyPress(finalKey, mods, keyval, finalStr)
    consumeLatches()
  }

  function sendCombo(keyname: string, mods: string[]) {
    onKeyPress(keyname, mods)
  }

  const FN_RIGHT = [
    { label: 'F7', key: 'F7', keyval: 0xffc4 },
    { label: 'F8', key: 'F8', keyval: 0xffc5 },
    { label: 'F9', key: 'F9', keyval: 0xffc6 },
    { label: 'F10', key: 'F10', keyval: 0xffc7 },
    { label: 'F11', key: 'F11', keyval: 0xffc8 },
    { label: 'F12', key: 'F12', keyval: 0xffc9 },
  ]

  const LETTERS_ROWS: KeyItem[][] = [
    [
      { label: '6', key: '6' },
      { label: '7', key: '7' },
      { label: '8', key: '8' },
      { label: '9', key: '9' },
      { label: '0', key: '0' },
      { label: '⌫', key: 'BackSpace', keyval: 0xff08, special: true },
    ],
    [
      { label: 'y', key: 'y' },
      { label: 'u', key: 'u' },
      { label: 'i', key: 'i' },
      { label: 'o', key: 'o' },
      { label: 'p', key: 'p' },
      { label: 'Del', key: 'Delete', keyval: 0xffff, special: true },
    ],
    [
      { label: 'h', key: 'h' },
      { label: 'j', key: 'j' },
      { label: 'k', key: 'k' },
      { label: 'l', key: 'l' },
      { label: ';', key: ';' },
      { label: '↵', key: 'Return', keyval: 0xff0d, enter: true },
    ],
    [
      { label: 'n', key: 'n' },
      { label: 'm', key: 'm' },
      { label: ',', key: ',' },
      { label: '.', key: '.' },
      { label: '/', key: '/' },
      { label: '▲', key: 'Up', keyval: 0xff52, arrow: true },
    ],
  ]

  const SYMBOLS_ROWS: KeyItem[][] = [
    [
      { label: '^', key: '^' },
      { label: '&', key: '&' },
      { label: '*', key: '*' },
      { label: '(', key: '(' },
      { label: ')', key: ')' },
      { label: '⌫', key: 'BackSpace', keyval: 0xff08, special: true },
    ],
    [
      { label: ']', key: ']' },
      { label: '}', key: '}' },
      { label: ':', key: ':' },
      { label: '"', key: '"' },
      { label: "'", key: "'" },
      { label: 'Del', key: 'Delete', keyval: 0xffff, special: true },
    ],
    [
      { label: '>', key: '>' },
      { label: '?', key: '?' },
      { label: '/', key: '/' },
      { label: ';', key: ';' },
      { label: '"', key: '"' },
      { label: '↵', key: 'Return', keyval: 0xff0d, enter: true },
    ],
    [
      { label: '$', key: '$' },
      { label: '€', key: '€' },
      { label: '£', key: '£' },
      { label: ',', key: ',' },
      { label: '.', key: '.' },
      { label: '▲', key: 'Up', keyval: 0xff52, arrow: true },
    ],
  ]
</script>

<aside class="landscape-wing right-wing">
  <!-- Top Utility Toolbar -->
  <div class="wing-toolbar">
    <button class="t-btn mouse-btn" onclick={() => onMouseButton(3)}>Right Click</button>
    <button class="t-btn {isZoomFit ? 'active' : ''}" onclick={onZoomFit}>
      {isZoomFit ? 'Fit' : '1:1'}
    </button>
    <button class="t-btn voice-btn" onclick={onVoiceInput} title="Voice / Dictate">🎙️</button>
    <button class="t-btn corner-top-right" onclick={onToggleFullscreen} title="Fullscreen">
      {isFullscreen ? '⛶ Off' : '⛶'}
    </button>
    {#if onToggleLock}
      <button class="t-btn lock-btn" onclick={onToggleLock} title="Touch / Pocket Lock">🔒</button>
    {/if}
    {#if onOpenSettings}
      <button class="t-btn" onclick={onOpenSettings} title="Settings">⚙️</button>
    {/if}
  </div>

  <!-- Right Shortcuts & Function Keys Area -->
  <div class="shortcuts-container">
    <div class="shortcut-row">
      {#each FN_RIGHT as f}
        <button class="s-btn fn" onclick={() => pressKey(f.key, f.keyval)}>{f.label}</button>
      {/each}
    </div>
    <div class="shortcut-row">
      <button class="s-btn macro highlight" onclick={() => sendCombo('t', ['control', 'alt'])}>Term</button>
      <button class="s-btn macro" onclick={() => sendCombo('t', ['control'])}>^T</button>
      <button class="s-btn macro" onclick={() => sendCombo('w', ['control'])}>^W</button>
      <button class="s-btn macro" onclick={() => sendCombo('a', ['control'])}>^A</button>
      <button class="s-btn macro" onclick={() => sendCombo('f', ['control'])}>^F</button>
    </div>
    <div class="shortcut-row">
      <button class="s-btn macro" onclick={() => sendCombo('r', ['control'])}>^R</button>
      <button class="s-btn macro" onclick={() => pressKey('Insert', 0xff63)}>Ins</button>
      <button class="s-btn macro" onclick={() => pressKey('Home', 0xff50)}>Home</button>
      <button class="s-btn macro" onclick={() => pressKey('End', 0xff57)}>End</button>
      <button class="s-btn macro" onclick={() => pressKey('Prior', 0xff55)}>PgUp</button>
      <button class="s-btn macro" onclick={() => pressKey('Next', 0xff56)}>PgDn</button>
    </div>
  </div>

  <!-- Key Rows Area -->
  <div class="keys-container">
    {#if !isSymbols}
      {#each LETTERS_ROWS as row}
        <div class="key-row">
          {#each row as item, idx}
            <button
              class="k-btn {item.special ? 'special' : ''} {item.enter ? 'enter-btn' : ''} {item.arrow ? 'arrow-btn' : ''} {idx === row.length - 1 ? 'corner-right' : ''}"
              onclick={() => pressKey(item.key, item.keyval)}
            >
              {shiftState !== 'off' && !item.special && !item.enter && !item.arrow ? item.label.toUpperCase() : item.label}
            </button>
          {/each}
        </div>
      {/each}
    {:else}
      {#each SYMBOLS_ROWS as row}
        <div class="key-row">
          {#each row as item, idx}
            <button
              class="k-btn {item.special ? 'special' : ''} {item.enter ? 'enter-btn' : ''} {item.arrow ? 'arrow-btn' : ''} {idx === row.length - 1 ? 'corner-right' : ''}"
              onclick={() => pressKey(item.key, item.keyval)}
            >
              {item.label}
            </button>
          {/each}
        </div>
      {/each}
    {/if}

    <!-- Bottom Row (Space, Arrow keys) -->
    <div class="key-row bottom-row">
      <button class="k-btn space-btn" onclick={() => pressKey('space', 0x0020, ' ')}>
        ␣
      </button>
      <button class="k-btn arrow-btn" onclick={() => pressKey('Left', 0xff51)}>◄</button>
      <button class="k-btn arrow-btn" onclick={() => pressKey('Down', 0xff54)}>▼</button>
      <button class="k-btn arrow-btn corner-bottom-right" onclick={() => pressKey('Right', 0xff53)}>►</button>
    </div>
  </div>
</aside>

<style>
  .landscape-wing {
    display: flex;
    flex-direction: column;
    width: clamp(180px, 24vw, 210px);
    height: 100%;
    background: #0d1117;
    border-left: 1px solid #1f293d;
    padding-top: max(4px, env(safe-area-inset-top, 4px));
    padding-bottom: max(6px, env(safe-area-inset-bottom, 6px));
    padding-right: max(6px, env(safe-area-inset-right, 6px));
    padding-left: 4px;
    gap: 3px;
    box-sizing: border-box;
    user-select: none;
    flex-shrink: 0;
    overflow: hidden;
  }
  .wing-toolbar {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
    height: 28px;
  }
  .t-btn {
    flex: 1;
    background: #18202d;
    border: 1px solid #2d3b4e;
    color: #cbd5e0;
    border-radius: 6px;
    font-size: 10px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 2px;
    cursor: pointer;
    white-space: nowrap;
    min-height: 28px;
  }
  .t-btn.mouse-btn {
    background: #1c2738;
    color: #63b3ed;
    border-color: #3182ce;
    flex: 1.3;
  }
  .t-btn.mouse-btn:active {
    background: #2b6cb0;
    color: #fff;
  }
  .t-btn.active {
    background: #2b6cb0;
    color: #fff;
    border-color: #63b3ed;
  }
  .t-btn.voice-btn {
    font-size: 12px;
  }
  .t-btn.lock-btn {
    flex: 0.5;
    font-size: 13px;
    color: #f6e05e;
  }
  .shortcuts-container {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
    background: #131822;
    padding: 3px;
    border-radius: 6px;
    border: 1px solid #1e2638;
  }
  .shortcut-row {
    display: flex;
    gap: 3px;
    height: 24px;
  }
  .s-btn {
    flex: 1;
    background: #1a2230;
    border: 1px solid #2d3b50;
    color: #90cdf4;
    border-radius: 4px;
    font-size: 9.5px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    white-space: nowrap;
  }
  .s-btn.highlight {
    background: #203248;
    color: #bee3f8;
    border-color: #3182ce;
  }
  .s-btn:active {
    background: #2b6cb0;
    color: #fff;
  }
  .keys-container {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: auto;
  }
  .key-row {
    display: flex;
    gap: 4px;
    height: 38px;
  }
  .k-btn {
    flex: 1;
    background: #1a2230;
    border: 1px solid #2d3a4e;
    border-bottom: 2px solid #141c28;
    color: #edf2f7;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    min-width: 0;
    touch-action: manipulation;
  }
  .k-btn:active {
    background: #2b6cb0;
    color: #fff;
    transform: translateY(1px);
    border-bottom-width: 1px;
  }
  .k-btn.corner-right {
    min-width: 32px;
    padding-right: 2px;
  }
  .k-btn.special {
    background: #141a24;
    color: #a0aec0;
    font-size: 11.5px;
    flex: 1.15;
  }
  .k-btn.enter-btn {
    background: #2b6cb0;
    border-color: #4299e1;
    color: #fff;
    font-size: 15px;
    flex: 1.25;
  }
  .k-btn.arrow-btn {
    background: #151d28;
    color: #90cdf4;
    font-size: 12.5px;
  }
  .k-btn.corner-bottom-right {
    border-bottom-right-radius: 8px;
    padding-right: 4px;
    min-width: 34px;
  }
  .k-btn.space-btn {
    background: #1a2230;
    flex: 1.5;
    font-size: 15px;
    color: #a0aec0;
  }
</style>
