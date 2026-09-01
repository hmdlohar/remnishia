import { writable } from 'svelte/store'
import type { QualityPreset } from './xpra/client'

export type { QualityPreset } from './xpra/client'

export interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password: string
  ssl: boolean
  /** WebSocket path when proxied (e.g. '/xpra' behind the vite dev server). */
  path?: string
  quality?: QualityPreset
}

const KEY = 'rem.connections'

function uid(): string {
  return crypto.getRandomValues(new Uint32Array(1))[0].toString(36)
}

function load(): Connection[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Connection[]) : []
  } catch {
    return []
  }
}

function init() {
  const { subscribe, update, set } = writable<Connection[]>(load())
  return {
    subscribe,
    add(conn: Omit<Connection, 'id'>): string {
      const id = uid()
      update((list) => {
        const next = [...list, { ...conn, id }]
        localStorage.setItem(KEY, JSON.stringify(next))
        return next
      })
      return id
    },
    updateConn(id: string, patch: Partial<Omit<Connection, 'id'>>) {
      update((list) => {
        const next = list.map((c) => (c.id === id ? { ...c, ...patch } : c))
        localStorage.setItem(KEY, JSON.stringify(next))
        return next
      })
    },
    remove(id: string) {
      update((list) => {
        const next = list.filter((c) => c.id !== id)
        localStorage.setItem(KEY, JSON.stringify(next))
        return next
      })
    },
    set,
  }
}

export const connections = init()
