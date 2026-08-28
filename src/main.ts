import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// Register Service Worker for PWA
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('PWA service worker registration failed:', err)
    })
  })
}

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
