<script lang="ts">
  import { connections, type Connection } from '../lib/storage'
  import { navigate } from '../lib/router'

  let editing = $state<Connection | 'new' | null>(null)
  let form = $state({ name: '', host: '', port: 10000, username: '', password: '', ssl: false })

  function startNew() {
    form = { name: '', host: '', port: 10000, username: '', password: '', ssl: false }
    editing = 'new'
  }

  function startEdit(c: Connection) {
    form = { name: c.name, host: c.host, port: c.port, username: c.username, password: c.password, ssl: c.ssl }
    editing = c
  }

  function save() {
    if (!form.name.trim() || !form.host.trim()) return
    if (editing === 'new') connections.add({ ...form, name: form.name.trim(), host: form.host.trim() })
    else if (editing) connections.updateConn(editing.id, { ...form })
    editing = null
  }

  function del(id: string) {
    if (confirm('Delete this connection?')) connections.remove(id)
  }
</script>

<main class="home">
  <header>
    <h1>Remote</h1>
    <button class="primary" onclick={startNew}>+ Add</button>
  </header>

  {#if $connections.length === 0 && !editing}
    <p class="muted empty">No connections yet. Add your xpra server to get started.</p>
  {/if}

  <ul>
    {#each $connections as c (c.id)}
      <li>
        <button class="row" onclick={() => navigate(`#/c/${c.id}`)}>
          <span class="name">{c.name}</span>
          <span class="muted mono">{c.ssl ? 'wss' : 'ws'}://{c.host}:{c.port}</span>
        </button>
        <button class="icon" aria-label="Edit" onclick={() => startEdit(c)}>✎</button>
        <button class="icon danger" aria-label="Delete" onclick={() => del(c.id)}>✕</button>
      </li>
    {/each}
  </ul>

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
        <div class="actions">
          <button type="button" onclick={() => (editing = null)}>Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>
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
    margin-bottom: 12px;
  }
  .empty {
    margin-top: 48px;
    text-align: center;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  li {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }
  .row {
    flex: 1;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
  }
  .name {
    font-weight: 600;
  }
  .icon {
    width: 44px;
    padding: 0;
  }
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    z-index: 10;
  }
  .sheet {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    padding: 20px 16px calc(20px + env(safe-area-inset-bottom));
    width: 100%;
    max-width: 560px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 90vh;
    overflow: auto;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 14px;
    color: var(--muted);
  }
  .pair {
    display: flex;
    gap: 12px;
    align-items: end;
  }
  .pair label:first-child {
    flex: 1;
  }
  .check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
