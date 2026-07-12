// tsup build: emit the library entry and the `uigraph` bin as runnable ESM
// plus type declarations to dist/ for publish.
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node18',
})
