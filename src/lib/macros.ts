import { writable } from 'svelte/store'

export type SessionMode = 'nav' | 'dev' | 'edit' | 'custom'

export interface MacroItem {
  id: string
  label: string
  mode: SessionMode
  type: 'combo' | 'text' | 'key'
  key?: string
  modifiers?: string[]
  text?: string
}

export const DEFAULT_MACROS: MacroItem[] = [
  // Nav Mode
  { id: 'nav-esc', label: 'Esc', mode: 'nav', type: 'key', key: 'Escape' },
  { id: 'nav-tab', label: 'Tab', mode: 'nav', type: 'key', key: 'Tab' },
  { id: 'nav-pgup', label: 'PgUp', mode: 'nav', type: 'key', key: 'PageUp' },
  { id: 'nav-pgdn', label: 'PgDn', mode: 'nav', type: 'key', key: 'PageDown' },
  { id: 'nav-home', label: 'Home', mode: 'nav', type: 'key', key: 'Home' },
  { id: 'nav-end', label: 'End', mode: 'nav', type: 'key', key: 'End' },
  { id: 'nav-alttab', label: 'Alt+Tab', mode: 'nav', type: 'combo', key: 'Tab', modifiers: ['alt'] },
  { id: 'nav-altf4', label: 'Alt+F4', mode: 'nav', type: 'combo', key: 'F4', modifiers: ['alt'] },

  // Dev Mode
  { id: 'dev-c', label: '^C', mode: 'dev', type: 'combo', key: 'c', modifiers: ['control'] },
  { id: 'dev-z', label: '^Z', mode: 'dev', type: 'combo', key: 'z', modifiers: ['control'] },
  { id: 'dev-d', label: '^D', mode: 'dev', type: 'combo', key: 'd', modifiers: ['control'] },
  { id: 'dev-l', label: '^L', mode: 'dev', type: 'combo', key: 'l', modifiers: ['control'] },
  { id: 'dev-r', label: '^R', mode: 'dev', type: 'combo', key: 'r', modifiers: ['control'] },
  { id: 'dev-tmux', label: '^B', mode: 'dev', type: 'combo', key: 'b', modifiers: ['control'] },
  { id: 'dev-f5', label: 'F5', mode: 'dev', type: 'key', key: 'F5' },
  { id: 'dev-f12', label: 'F12', mode: 'dev', type: 'key', key: 'F12' },
  { id: 'dev-vim-w', label: ':w', mode: 'dev', type: 'text', text: ':w\n' },
  { id: 'dev-vim-q', label: ':q!', mode: 'dev', type: 'text', text: ':q!\n' },

  // Edit Mode
  { id: 'edit-all', label: '^A', mode: 'edit', type: 'combo', key: 'a', modifiers: ['control'] },
  { id: 'edit-copy', label: '^C', mode: 'edit', type: 'combo', key: 'c', modifiers: ['control'] },
  { id: 'edit-paste', label: '^V', mode: 'edit', type: 'combo', key: 'v', modifiers: ['control'] },
  { id: 'edit-cut', label: '^X', mode: 'edit', type: 'combo', key: 'x', modifiers: ['control'] },
  { id: 'edit-undo', label: '^Z', mode: 'edit', type: 'combo', key: 'z', modifiers: ['control'] },
  { id: 'edit-redo', label: '^Y', mode: 'edit', type: 'combo', key: 'y', modifiers: ['control'] },
  { id: 'edit-find', label: '^F', mode: 'edit', type: 'combo', key: 'f', modifiers: ['control'] },
  { id: 'edit-delw', label: '^Bksp', mode: 'edit', type: 'combo', key: 'Backspace', modifiers: ['control'] },
]

const KEY = 'rem.custom_macros'

function uid(): string {
  return crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
}

function loadCustom(): MacroItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as MacroItem[]) : []
  } catch {
    return []
  }
}

function initMacrosStore() {
  const { subscribe, update, set } = writable<MacroItem[]>(loadCustom())

  return {
    subscribe,
    add(macro: Omit<MacroItem, 'id' | 'mode'>): string {
      const id = uid()
      const item: MacroItem = { ...macro, id, mode: 'custom' }
      update((list) => {
        const next = [...list, item]
        localStorage.setItem(KEY, JSON.stringify(next))
        return next
      })
      return id
    },
    remove(id: string) {
      update((list) => {
        const next = list.filter((m) => m.id !== id)
        localStorage.setItem(KEY, JSON.stringify(next))
        return next
      })
    },
    set,
  }
}

export const customMacros = initMacrosStore()
