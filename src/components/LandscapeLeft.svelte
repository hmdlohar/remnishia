<script lang="ts">
  let {
    onKeyPress,
    onMouseButton,
    onToggleDragLock,
    isDragLocked = false,
    onBack,
    onToggleLock,
    isSymbols = $bindable(false),
    ctrlState = $bindable<'off' | 'latched' | 'locked'>('off'),
    altState = $bindable<'off' | 'latched' | 'locked'>('off'),
    shiftState = $bindable<'off' | 'latched' | 'locked'>('off'),
    metaState = $bindable<'off' | 'latched' | 'locked'>('off'),
  }: {
    onKeyPress: (keyname: string, modifiers: string[], keyval?: number, str?: string) => void
    onMouseButton: (button: number) => void
    onToggleDragLock: () => void
    isDragLocked?: boolean
    onBack?: () => void
    onToggleLock?: () => void
    isSymbols?: boolean
    ctrlState?: 'off' | 'latched' | 'locked'
    altState?: 'off' | 'latched' | 'locked'
    shiftState?: 'off' | 'latched' | 'locked'
    metaState?: 'off' | 'latched' | 'locked'
  } = $props()

  type ModKey = 'control' | 'alt' | 'shift' | 'meta'

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

  const FN_LEFT = [
    { label: 'F1', key: 'F1', keyval: 0xffbe },
    { label: 'F2', key: 'F2', keyval: 0xffbf },
    { label: 'F3', key: 'F3', keyval: 0xffc0 },
    { label: 'F4', key: 'F4', keyval: 0xffc1 },
    { label: 'F5', key: 'F5', keyval: 0xffc2 },
    { label: 'F6', key: 'F6', keyval: 0xffc3 },
  ]

  const LETTERS_ROWS = [
    ['1', '2', '3', '4', '5'],
    ['q', 'w', 'e', 'r', 't'],
    ['a', 's', 'd', 'f', 'g'],
    ['z', 'x', 'c', 'v', 'b'],
  ]

  const SYMBOLS_ROWS = [
    ['~', '!', '@', '#', '$'],
    ['%', '^', '&', '*', '('],
    ['\\', '|', '[', '{', '<'],
    ['+', '-', '=', '_', '`'],
  ]
</script>

<aside class="landscape-wing left-wing">
  <!-- Top Utility Toolbar -->
  <div class="wing-toolbar">
    {#if onBack}
      <button class="t-btn back-btn corner-top" onclick={onBack} title="Back to Connections">‹</button>
    {/if}
    <button class="t-btn mouse-btn" onclick={() => onMouseButton(1)}>Left Click</button>
    <button class="t-btn {isDragLocked ? 'active' : ''}" onclick={onToggleDragLock}>
      {isDragLocked ? '🔒 Drag' : 'Drag'}
    </button>
    {#if onToggleLock}
      <button class="t-btn lock-btn" onclick={onToggleLock} title="Touch / Pocket Lock">🔒</button>
    {/if}
  </div>

  <!-- Left Shortcuts & Function Keys Area -->
  <div class="shortcuts-container">
    <div class="shortcut-row">
      {#each FN_LEFT as f}
        <button class="s-btn fn" onclick={() => pressKey(f.key, f.keyval)}>{f.label}</button>
      {/each}
    </div>
    <div class="shortcut-row">
      <button class="s-btn macro highlight" onclick={() => sendCombo('Tab', ['alt'])}>Alt+Tab</button>
      <button class="s-btn macro highlight" onclick={() => sendCombo('Super_L', [])}>Super</button>
      <button class="s-btn macro" onclick={() => sendCombo('c', ['control'])}>^C</button>
      <button class="s-btn macro" onclick={() => sendCombo('v', ['control'])}>^V</button>
      <button class="s-btn macro" onclick={() => sendCombo('x', ['control'])}>^X</button>
    </div>
    <div class="shortcut-row">
      <button class="s-btn macro" onclick={() => sendCombo('z', ['control'])}>^Z</button>
      <button class="s-btn macro" onclick={() => sendCombo('y', ['control'])}>^Y</button>
      <button class="s-btn macro" onclick={() => sendCombo('s', ['control'])}>^S</button>
      <button class="s-btn macro highlight" onclick={() => sendCombo('d', ['control'])}>^D</button>
    </div>
  </div>

  <!-- Key Rows Area -->
  <div class="keys-container">
    <!-- Extra navigation row (Esc, Tab) -->
    <div class="key-row nav-row">
      <button class="k-btn special corner-left" onclick={() => pressKey('Escape', 0xff1b)}>Esc</button>
      <button class="k-btn special" onclick={() => pressKey('Tab', 0xff09)}>Tab</button>
    </div>

    {#if !isSymbols}
      {#each LETTERS_ROWS as row}
        <div class="key-row">
          {#each row as k, idx}
            <button class="k-btn char {idx === 0 ? 'corner-left' : ''}" onclick={() => pressKey(k)}>
              {shiftState !== 'off' ? k.toUpperCase() : k}
            </button>
          {/each}
        </div>
      {/each}
    {:else}
      {#each SYMBOLS_ROWS as row}
        <div class="key-row">
          {#each row as k, idx}
            <button class="k-btn char sym {idx === 0 ? 'corner-left' : ''}" onclick={() => pressKey(k)}>
              {k}
            </button>
          {/each}
        </div>
      {/each}
    {/if}

    <!-- Bottom Modifier & Space Row -->
    <div class="key-row bottom-row">
      <button class="k-btn switch-btn corner-bottom-left" onclick={() => (isSymbols = !isSymbols)}>
        {isSymbols ? 'ABC' : '?123'}
      </button>
      <button class="k-btn mod {shiftState}" onclick={() => toggleModifier('shift')}>
        ⇧{shiftState === 'locked' ? '🔒' : shiftState === 'latched' ? '•' : ''}
      </button>
      <button class="k-btn mod {ctrlState}" onclick={() => toggleModifier('control')}>
        Ctrl{ctrlState === 'locked' ? '🔒' : ctrlState === 'latched' ? '•' : ''}
      </button>
      <button class="k-btn mod {altState}" onclick={() => toggleModifier('alt')}>
        Alt{altState === 'locked' ? '🔒' : altState === 'latched' ? '•' : ''}
      </button>
      <button class="k-btn space-btn" onclick={() => pressKey('space', 0x0020, ' ')}>
        ␣
      </button>
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
    border-right: 1px solid #1f293d;
    padding-top: max(4px, env(safe-area-inset-top, 4px));
    padding-bottom: max(6px, env(safe-area-inset-bottom, 6px));
    padding-left: max(6px, env(safe-area-inset-left, 6px));
    padding-right: 4px;
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
  .t-btn.back-btn {
    flex: 0.55;
    font-size: 16px;
    font-weight: 700;
    color: #cbd5e0;
    background: #161e2b;
    min-width: 28px;
  }
  .t-btn.mouse-btn {
    background: #1c2738;
    color: #63b3ed;
    border-color: #3182ce;
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
  .nav-row {
    height: 26px;
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
  .k-btn.char {
    font-weight: 600;
  }
  .k-btn.corner-left {
    min-width: 32px;
    padding-left: 2px;
  }
  .k-btn.special {
    background: #141a24;
    color: #a0aec0;
    font-size: 11.5px;
  }
  .k-btn.switch-btn {
    background: #151e2b;
    color: #90cdf4;
    font-size: 11px;
    font-weight: 700;
    flex: 1.35;
    min-width: 36px;
    border-color: #2b4365;
  }
  .k-btn.corner-bottom-left {
    border-bottom-left-radius: 8px;
    padding-left: 4px;
  }
  .k-btn.mod {
    background: #151a24;
    color: #cbd5e0;
    font-size: 11px;
  }
  .k-btn.mod.latched {
    background: #744210;
    border-color: #d69e2e;
    color: #fefcbf;
  }
  .k-btn.mod.locked {
    background: #2b6cb0;
    border-color: #63b3ed;
    color: #fff;
  }
  .k-btn.space-btn {
    background: #1a2230;
    flex: 1.3;
    font-size: 15px;
    color: #a0aec0;
  }
</style>
