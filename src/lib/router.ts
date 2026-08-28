import { readable } from 'svelte/store'

export interface Route {
  view: 'home' | 'session'
  id?: string
}

function parse(): Route {
  const m = location.hash.match(/^#\/c\/(.+)$/)
  if (m) return { view: 'session', id: m[1] }
  return { view: 'home' }
}

export const route = readable<Route>(parse(), (set) => {
  const onHash = () => set(parse())
  window.addEventListener('hashchange', onHash)
  return () => window.removeEventListener('hashchange', onHash)
})

export function navigate(hash: string) {
  location.hash = hash
}
