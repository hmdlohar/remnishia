import { svelte } from '@sveltejs/vite-plugin-svelte'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), basicSsl()],
  server: {
    host: true,
    // WebCodecs/WebCrypto need a secure context: the self-signed HTTPS dev
    // server provides one for phone access (https://<lan-ip>:5173).
    // /xpra is proxied to the local xpra server so the app and its
    // WebSocket share one origin (no mixed content on https pages).
    proxy: {
      '/xpra': {
        target: 'ws://localhost:10000',
        ws: true,
      },
    },
  },
})

