<script lang="ts">
  import { onMount } from 'svelte'
  import { connections, type Connection, type QualityPreset } from '../lib/storage'
  import { navigate } from '../lib/router'
  import { subscribePwa, promptInstall, isStandalone } from '../lib/pwa'
  import { QUALITY_PRESETS } from '../lib/xpra/client'

  const QUALITY_ORDER: QualityPreset[] = ['saver', 'balanced', 'lossless']

  let editing = $state<Connection | 'new' | null>(null)
  let form = $state({
    name: '',
    host: '',
    port: 10000,
    username: '',
    password: '',
    ssl: false,
    quality: 'balanced' as QualityPreset,
    path: '/',
  })
  let canAutoInstall = $state(false)
  let isAppStandalone = $state(false)
  let showInstallGuide = $state(false)

  onMount(() => {
    isAppStandalone = isStandalone()
    return subscribePwa((can) => {
      canAutoInstall = can
    })
  })

  async function handleInstallClick() {
    if (canAutoInstall) {
      const installed = await promptInstall()
      if (installed) return
    }
    showInstallGuide = true
  }

  function startNew() {
    form = {
      name: '',
      host: '',
      port: 10000,
      username: '',
      password: '',
      ssl: false,
      quality: 'balanced',
      path: '/',
    }
    editing = 'new'
  }

  function startEdit(c: Connection) {
    form = {
      name: c.name,
      host: c.host,
      port: c.port,
      username: c.username,
      password: c.password,
      ssl: c.ssl,
      quality: c.quality ?? 'balanced',
      path: c.path ?? '/',
    }
    editing = c
  }

  function qualityHint(q: QualityPreset): string {
    switch (q) {
      case 'saver':
        return 'Lowest data usage (~300-600 KB/s), softer picture — best for mobile data'
      case 'balanced':
        return 'Server auto-tunes quality to connection speed'
      case 'lossless':
        return 'Pixel-perfect, high data usage — best for WiFi'
    }
  }

  function save() {
    if (!form.name.trim() || !form.host.trim()) return

    const data = {
      name: form.name.trim(),
      host: form.host.trim(),
      port: form.port,
      username: form.username,
      password: form.password,
      ssl: form.ssl,
      quality: form.quality,
      path: form.path.trim() || '/',
    }

    if (editing === 'new') {
      connections.add(data)
    } else if (editing) {
      connections.updateConn(editing.id, data)
    }
    editing = null
  }

  function del(id: string) {
    if (confirm('Delete this connection?')) connections.remove(id)
  }
</script>

<main class="home">
  <header>
    <div class="brand">
      <img src="/favicon.svg" alt="rem logo" class="brand-icon" />
      <h1>Remote</h1>
    </div>
    <div class="header-actions">
      {#if !isAppStandalone}
        <button class="icon-btn install-header-btn" onclick={handleInstallClick} title="Install PWA">
          📲 Install
        </button>
      {/if}
      <button class="primary" onclick={startNew}>+ Add</button>
    </div>
  </header>

  {#if !isAppStandalone}
    <div class="install-banner">
      <div class="install-text">
        <strong>Install rem App</strong>
        <span class="muted">Add to home screen for fullscreen remote desktop without browser bars</span>
      </div>
      <button class="install-btn" onclick={handleInstallClick}>Install 📲</button>
    </div>
  {/if}

  {#if $connections.length === 0 && !editing}
    <p class="muted empty">No connections yet. Add your xpra server to get started.</p>
  {/if}

  <ul>
    {#each $connections as c (c.id)}
      <li>
        <button class="row" onclick={() => navigate(`#/c/${c.id}`)}>
          <div class="name-row">
            <span class="name">{c.name}</span>
            {#if (c.quality ?? 'balanced') !== 'balanced'}
              <span class="res-badge quality-badge">{c.quality}</span>
            {/if}
          </div>
          <span class="muted mono">{c.ssl ? 'wss' : 'ws'}://{c.host}:{c.port}</span>
        </button>
        <button class="icon" aria-label="Edit" onclick={() => startEdit(c)}>✎</button>
        <button class="icon danger" aria-label="Delete" onclick={() => del(c.id)}>✕</button>
      </li>
    {/each}
  </ul>

  <!-- Edit / Add Connection Modal -->
  {#if editing}
    <div
      class="scrim"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.target === e.currentTarget && (editing = null)}
      onkeydown={(e) => e.key === 'Escape' && (editing = null)}
    >
      <form
        class="sheet"
        onsubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <h2>{editing === 'new' ? 'New connection' : 'Edit connection'}</h2>
        <label>Name <input bind:value={form.name} placeholder="my PC" required /></label>
        <label>Host <input bind:value={form.host} placeholder="192.168.1.10" required /></label>
        <div class="pair">
          <label>Port <input type="number" bind:value={form.port} min="1" max="65535" /></label>
          <label class="check">
            <input type="checkbox" bind:checked={form.ssl} style="width:auto" />
            SSL (wss)
          </label>
        </div>
        <label>Username <input bind:value={form.username} autocomplete="off" /></label>
        <label>Password <input type="password" bind:value={form.password} autocomplete="off" /></label>
        <label
          >WS Path <input bind:value={form.path} placeholder="/" />
          <span class="muted" style="font-size:10px">use /xpra when connecting through the dev server proxy</span>
        </label>

        <!-- Image Quality Configuration -->
        <div class="res-config-box">
          <span class="res-label">Image Quality</span>
          <div class="preset-row">
            {#each QUALITY_ORDER as preset (preset)}
              <button
                type="button"
                class="preset-btn {form.quality === preset ? 'active' : ''}"
                onclick={() => (form.quality = preset)}
              >
                {QUALITY_PRESETS[preset].label}
              </button>
            {/each}
          </div>
          <span class="quality-hint">{qualityHint(form.quality)}</span>
        </div>

        <div class="actions">
          <button type="button" onclick={() => (editing = null)}>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
    </div>
  {/if}

  <!-- PWA Install Guide Modal -->
  {#if showInstallGuide}
    <div
      class="scrim"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(e) => e.target === e.currentTarget && (showInstallGuide = false)}
      onkeydown={(e) => e.key === 'Escape' && (showInstallGuide = false)}
    >
      <div class="sheet guide-sheet">
        <h2>How to Install rem</h2>
        <p class="muted">Install <strong>rem</strong> on your phone for a full-screen, native-app experience:</p>

        <div class="guide-box">
          <strong>📱 Chrome / Brave / Edge (Android):</strong>
          <ol>
            <li>Tap the browser menu button <strong>⋮</strong> (top or bottom right).</li>
            <li>Select <strong>"Add to Home screen"</strong> or <strong>"Install app"</strong>.</li>
            <li>Tap <strong>Add / Install</strong> to confirm.</li>
          </ol>
        </div>

        <div class="guide-box">
          <strong>🍏 Safari (iOS / iPhone):</strong>
          <ol>
            <li>Tap the <strong>Share</strong> icon (square with arrow <strong>⬆</strong>).</li>
            <li>Scroll down and tap <strong>"Add to Home Screen"</strong>.</li>
            <li>Tap <strong>Add</strong> in the top right corner.</li>
          </ol>
        </div>

        <div class="actions">
          <button type="button" class="primary" onclick={() => (showInstallGuide = false)}>
            Got it
          </button>
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  .home {
    max-width: 560px;
    margin: 0 auto;
    padding: 16px;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .brand-icon {
    width: 28px;
    height: 28px;
    border-radius: 6px;
  }
  h1 {
    font-size: 20px;
    margin: 0;
  }
  .header-actions {
    display: flex;
    gap: 8px;
  }
  .install-header-btn {
    background: #1c2536;
    color: #90cdf4;
    border: 1px solid #2b6cb0;
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .install-banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: #151d2a;
    border: 1px solid #2b6cb0;
    border-radius: 10px;
    padding: 12px 14px;
    margin-bottom: 16px;
    gap: 12px;
  }
  .install-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .install-text strong {
    font-size: 13px;
    color: #90cdf4;
  }
  .install-text .muted {
    font-size: 11px;
    line-height: 1.3;
  }
  .install-btn {
    background: #2b6cb0;
    color: #fff;
    border: 1px solid #63b3ed;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .empty {
    text-align: center;
    padding: 32px 0;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    align-items: center;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 4px;
    gap: 4px;
  }
  .row {
    flex: 1;
    background: transparent;
    border: none;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    cursor: pointer;
    color: inherit;
    min-width: 0;
  }
  .name-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .name {
    font-weight: 500;
  }
  .res-badge {
    font-size: 10px;
    background: #1e2634;
    border: 1px solid #2d3748;
    color: #90cdf4;
    border-radius: 4px;
    padding: 1px 4px;
    font-family: var(--mono);
  }
  .icon {
    width: 36px;
    height: 36px;
    padding: 0;
    background: transparent;
    border: none;
    color: var(--fg-muted);
    font-size: 16px;
    cursor: pointer;
    border-radius: 6px;
  }
  .icon:hover {
    background: rgba(255, 255, 255, 0.05);
  }
  .icon.danger:hover {
    color: var(--err);
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 100;
  }
  .sheet {
    background: #151921;
    border: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    width: 100%;
    max-width: 560px;
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.8);
  }
  .guide-sheet {
    max-height: 85vh;
    overflow-y: auto;
  }
  .guide-box {
    background: #1a2332;
    border: 1px solid #2d3b52;
    border-radius: 8px;
    padding: 12px;
    font-size: 12px;
  }
  .guide-box ol {
    margin: 6px 0 0 16px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: #cbd5e0;
  }
  .res-config-box {
    background: #1a222f;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .res-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--fg-muted);
  }
  .preset-row {
    display: flex;
    gap: 6px;
  }
  .preset-btn {
    flex: 1;
    font-size: 11px;
    padding: 4px 6px;
    background: #151a24;
    border: 1px solid #2d3748;
    color: var(--text);
    border-radius: 6px;
    cursor: pointer;
  }
  .preset-btn.active {
    background: #2b6cb0;
    border-color: #63b3ed;
    color: #fff;
  }
  .quality-hint {
    font-size: 10px;
    color: var(--fg-muted);
    line-height: 1.3;
  }
  .quality-badge {
    color: #f6ad55;
    border-color: #7b5219;
  }
  .sheet h2 {
    margin: 0;
    font-size: 16px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--fg-muted);
  }
  .pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    align-items: end;
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    height: 36px;
    cursor: pointer;
    color: var(--text);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
</style>
