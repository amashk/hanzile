import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    // Fail loudly instead of silently moving to 5174 (the firewall rule only opens 5173).
    strictPort: true,
  },
})
