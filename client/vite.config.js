import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // No dev proxy: the client will call Google APIs directly in client-side mode.
  server: {}
})
