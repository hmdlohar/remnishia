<script lang="ts">
  let {
    onKeyPress,
    onMouseButton,
    onToggleKbd,
    showKbd = false,
  }: {
    onKeyPress: (keyname: string, modifiers: string[], keyval?: number, str?: string) => void
    onMouseButton: (button: number) => void
    onToggleKbd: () => void
    showKbd?: boolean
  } = $props()

  type ModKey = 'control' | 'alt' | 'shift' | 'meta'
  type ModState = 'off' | 'latched' | 'locked'

  let ctrlState = $state<ModState>('off')
  let altState = $state<ModState>('off')
  let shiftState = $state<ModState>('off')
  let metaState = $state<ModState>('off')

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
    onKeyPress(keyname, mods, keyval, str)
    consumeLatches()
  }

  function sendMacro(macro: string) {
    if (macro === 'ctrl+c') onKeyPress('c', ['control'], 'c'.charCodeAt(0), 'c')
    else if (macro === 'ctrl+v') onKeyPress('v', ['control'], 'v'.charCodeAt(0), 'v')
    else if (macro === 'ctrl+z') onKeyPress('z', ['control'], 'z'.charCodeAt(0), 'z')
    else if (macro === 'ctrl+s') onKeyPress('s', ['control'], 's'.charCodeAt(0), 's')
    else if (macro === 'ctrl+w') onKeyPress('w', ['control'], 'w'.charCodeAt(0), 'w')
    else if (macro === 'ctrl+t') onKeyPress('t', ['control'], 't'.charCodeAt(0), 't')
  }
</script>

<aside class="wing left">
  <div class="panel-section dpad">
    <div class="dpad-row">
      <button class="dbtn" onclick={() => pressKey('Up', 0xff52)}>▲</button>
    </div>
    <div class="dpad-row middle">
      <button class="dbtn" onclick={() => pressKey('Left', 0xff51)}>◄</button>
      <button class="dbtn center" onclick={() => pressKey('Return', 0xff0d)}>↵</button>
      <button class="dbtn" onclick={() => pressKey('Right', 0xff53)}>►</button>
    </div>
    <div class="dpad-row">
      <button class="dbtn" onclick={() => pressKey('Down', 0xff54)}>▼</button>
    </div>
  </div>

  <div class="panel-section mod-col">
    <button class="wbtn mod {ctrlState}" onclick={() => toggleModifier('control')}>
      Ctrl {ctrlState === 'locked' ? '🔒' : ctrlState === 'latched' ? '•' : ''}
    </button>
    <button class="wbtn mod {altState}" onclick={() => toggleModifier('alt')}>
      Alt {altState === 'locked' ? '🔒' : altState === 'latched' ? '•' : ''}
    </button>
    <button class="wbtn mod {shiftState}" onclick={() => toggleModifier('shift')}>
      Shift {shiftState === 'locked' ? '🔒' : shiftState === 'latched' ? '•' : ''}
    </button>
    <button class="wbtn mod {metaState}" onclick={() => toggleModifier('meta')}>
      Super {metaState === 'locked' ? '🔒' : metaState === 'latched' ? '•' : ''}
    </button>
  </div>

  <div class="panel-section row-tools">
    <button class="wbtn" onclick={() => pressKey('Escape', 0xff1b)}>Esc</button>
    <button class="wbtn" onclick={() => pressKey('Tab', 0xff09)}>Tab</button>
  </div>
</aside>

<aside class="wing right">
  <div class="panel-section mouse-tools">
    <button class="wbtn mouse-btn" onclick={() => onMouseButton(1)}>Left Click</button>
    <button class="wbtn mouse-btn" onclick={() => onMouseButton(3)}>Right Click</button>
    <button class="wbtn mouse-btn" onclick={() => onMouseButton(2)}>Mid Click</button>
  </div>

  <div class="panel-section macro-grid">
    <button class="wbtn macro" onclick={() => sendMacro('ctrl+c')}>^C</button>
    <button class="wbtn macro" onclick={() => sendMacro('ctrl+v')}>^V</button>
    <button class="wbtn macro" onclick={() => sendMacro('ctrl+z')}>^Z</button>
    <button class="wbtn macro" onclick={() => sendMacro('ctrl+s')}>^S</button>
    <button class="wbtn macro" onclick={() => pressKey('BackSpace', 0xff08)}>⌫</button>
    <button class="wbtn macro" onclick={() => pressKey('Delete', 0xffff)}>Del</button>
  </div>

  <div class="panel-section row-tools">
    <button class="wbtn kbd-toggle {showKbd ? 'active' : ''}" onclick={onToggleKbd}>⌨</button>
  </div>
</aside>

<style>
  .wing {
    display: flex;
    flex-direction: column;
    width: 140px;
    background: #11141a;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 6px;
    gap: 6px;
    flex-shrink: 0;
    user-select: none;
    box-sizing: border-box;
  }
  .panel-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .wbtn {
    height: 32px;
    padding: 0 4px;
    font-size: 12px;
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
  .wbtn:active {
    background: #3182ce;
    color: #fff;
  }
  .wbtn.mod {
    font-size: 11px;
    background: #1e2634;
  }
  .wbtn.mod.latched {
    background: #2b6cb0;
    border-color: #63b3ed;
    color: #fff;
  }
  .wbtn.mod.locked {
    background: #9b2c2c;
    border-color: #fc8181;
    color: #fff;
  }
  .dpad {
    align-items: center;
    gap: 2px;
  }
  .dpad-row {
    display: flex;
    gap: 2px;
  }
  .dbtn {
    width: 38px;
    height: 30px;
    padding: 0;
    font-size: 11px;
    background: #1c222d;
    border: 1px solid #2d3748;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dbtn.center {
    font-size: 13px;
    background: #2b6cb0;
    color: #fff;
  }
  .dbtn:active {
    background: #3182ce;
  }
  .row-tools {
    display: flex;
    flex-direction: row;
    gap: 4px;
  }
  .row-tools .wbtn {
    flex: 1;
  }
  .mouse-btn {
    background: #242c3b;
    font-size: 11px;
    height: 28px;
  }
  .macro-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .macro {
    font-size: 11px;
    height: 28px;
  }
  .kbd-toggle.active {
    border-color: var(--accent);
    background: #2b6cb0;
    color: #fff;
  }
</style>
