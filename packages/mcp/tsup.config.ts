// tsup build: emit runnable ESM + type declarations to dist/ for publish.
// Workspace and runtime deps are auto-externalized (not bundled).
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  external: [/^node:/],
})
