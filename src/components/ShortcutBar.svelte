<script lang="ts">
  import { DEFAULT_MACROS, customMacros, type MacroItem, type SessionMode } from '../lib/macros'

  let {
    onExecute,
  }: {
    onExecute: (macro: MacroItem) => void
  } = $props()

  let currentMode = $state<SessionMode>('dev')
  let showAddModal = $state(false)
  let newLabel = $state('')
  let newType = $state<'text' | 'combo'>('text')
  let newText = $state('')
  let newKey = $state('')
  let newCtrl = $state(false)
  let newAlt = $state(false)
  let newShift = $state(false)

  let activeMacros = $derived(
    currentMode === 'custom'
      ? $customMacros
      : DEFAULT_MACROS.filter((m) => m.mode === currentMode),
  )

  function handleAdd() {
    if (!newLabel.trim()) return
    const mods: string[] = []
    if (newCtrl) mods.push('control')
    if (newAlt) mods.push('alt')
    if (newShift) mods.push('shift')

    if (newType === 'text') {
      if (!newText) return
      customMacros.add({
        label: newLabel.trim(),
        type: 'text',
        text: newText,
      })
    } else {
      if (!newKey.trim()) return
      customMacros.add({
        label: newLabel.trim(),
        type: 'combo',
        key: newKey.trim(),
        modifiers: mods,
      })
    }

    newLabel = ''
    newText = ''
    newKey = ''
    newCtrl = false
    newAlt = false
    newShift = false
    showAddModal = false
  }
</script>

<div class="shortcut-bar">
  <!-- Mode Switcher -->
  <div class="modes">
    <button class="mode-tab {currentMode === 'nav' ? 'active' : ''}" onclick={() => (currentMode = 'nav')}>
      Nav
    </button>
    <button class="mode-tab {currentMode === 'dev' ? 'active' : ''}" onclick={() => (currentMode = 'dev')}>
      Dev
    </button>
    <button class="mode-tab {currentMode === 'edit' ? 'active' : ''}" onclick={() => (currentMode = 'edit')}>
      Edit
    </button>
    <button class="mode-tab {currentMode === 'fn' ? 'active' : ''}" onclick={() => (currentMode = 'fn')}>
      Fn
    </button>
    <button class="mode-tab {currentMode === 'custom' ? 'active' : ''}" onclick={() => (currentMode = 'custom')}>
      Custom
    </button>
  </div>

  <!-- Macro Scroll Strip -->
  <div class="macro-strip">
    {#each activeMacros as m (m.id)}
      <button class="macro-btn" onclick={() => onExecute(m)}>
        {m.label}
      </button>
    {/each}

    {#if currentMode === 'custom'}
      <button class="macro-btn add-btn" onclick={() => (showAddModal = true)}>
        + Add Macro
      </button>
    {/if}
  </div>

  <!-- Add Macro Modal -->
  {#if showAddModal}
    <div class="modal-backdrop">
      <div class="modal-card">
        <h3>New Custom Macro</h3>
        <label>
          <span>Label</span>
          <input type="text" bind:value={newLabel} placeholder="e.g. git status or ^K" />
        </label>

        <div class="type-row">
          <label class="radio-label">
            <input type="radio" value="text" bind:group={newType} /> Text / Command
          </label>
          <label class="radio-label">
            <input type="radio" value="combo" bind:group={newType} /> Key Shortcut
          </label>
        </div>

        {#if newType === 'text'}
          <label>
            <span>Command / Text to inject</span>
            <input type="text" bind:value={newText} placeholder="e.g. git status&#10;" />
          </label>
        {:else}
          <label>
            <span>Key</span>
            <input type="text" bind:value={newKey} placeholder="e.g. k, F8, Return" />
          </label>
          <div class="mod-checkboxes">
            <label><input type="checkbox" bind:checked={newCtrl} /> Ctrl</label>
            <label><input type="checkbox" bind:checked={newAlt} /> Alt</label>
            <label><input type="checkbox" bind:checked={newShift} /> Shift</label>
          </div>
        {/if}

        <div class="modal-actions">
          <button type="button" onclick={() => (showAddModal = false)}>Cancel</button>
          <button type="button" class="primary" onclick={handleAdd}>Save</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .shortcut-bar {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: #11141a;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px 6px;
    flex-shrink: 0;
    user-select: none;
  }
  .modes {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    padding-bottom: 4px;
  }
  .mode-tab {
    padding: 2px 8px;
    font-size: 11px;
    height: 24px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--muted);
    border-radius: 4px;
    font-weight: 500;
  }
  .mode-tab.active {
    background: #1c222d;
    border-color: var(--accent);
    color: var(--accent);
  }
  .macro-strip {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding: 2px 0;
    scrollbar-width: none;
  }
  .macro-strip::-webkit-scrollbar {
    display: none;
  }
  .macro-btn {
    flex: 0 0 auto;
    font-size: 12px;
    padding: 3px 8px;
    height: 28px;
    background: #1c222d;
    color: #e2e8f0;
    border: 1px solid #2d3748;
    border-radius: 6px;
    font-family: var(--mono);
    white-space: nowrap;
  }
  .macro-btn:active {
    background: #3182ce;
    color: #fff;
  }
  .macro-btn.add-btn {
    background: #232c3b;
    border-color: var(--accent);
    color: var(--accent);
  }
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
  }
  .modal-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .modal-card h3 {
    margin: 0;
    font-size: 16px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .type-row {
    display: flex;
    gap: 16px;
  }
  .radio-label {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  .mod-checkboxes {
    display: flex;
    gap: 12px;
  }
  .mod-checkboxes label {
    flex-direction: row;
    align-items: center;
    gap: 4px;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
