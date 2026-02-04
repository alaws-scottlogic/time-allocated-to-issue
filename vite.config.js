import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  return {
    plugins: [react()],
    // Base is required for GitHub Pages project site deployment.
    base: mode === 'production' ? '/time-allocated-to-issue/' : '/',
    // No dev proxy: the client will call Google APIs directly in client-side mode.
    server: {}
  }
})
