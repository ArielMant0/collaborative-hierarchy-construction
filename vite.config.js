import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const BASE_PATH = "/collaborative-hierarchy-construction"

export default defineConfig({
  base: BASE_PATH,
  plugins: [vue()],
  server: { 
    base: BASE_PATH,
    proxy: {
      '/myapp': {
        target: 'http://localhost:9000',
        changeOrigin: true,
        ws: true // Enables WebSocket tunneling for PeerJS
      }
    }
  },
  preview: { base: BASE_PATH }
})