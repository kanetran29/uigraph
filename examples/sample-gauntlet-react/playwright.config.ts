import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './specs',
  use: { baseURL: process.env.APP_URL ?? 'http://localhost:5187' },
})
