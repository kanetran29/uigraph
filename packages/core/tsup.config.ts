// tsup build: emit runnable ESM + type declarations to dist/ for publish.
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/node.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node18',
})
