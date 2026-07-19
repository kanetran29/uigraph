import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Pin the dev port to match playwright.config.ts's baseURL default (5187) so a
  // plain `pnpm dev` is drivable by the gate's --app-url without extra flags.
  server: { port: 5187 },
})
