// tsup build: emit runnable ESM + type declarations to dist/ for publish.
// esbuild strips the `node:` prefix from builtins; harmless for `fs`/`crypto`
// (Node resolves them bare) but FATAL for `node:sqlite`, which exists ONLY under
// the prefix. esbuild resolves builtins before plugins can intercept, so we pin
// the prefix back in an onSuccess pass over the emitted files.
import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/node.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  target: 'node22',
  onSuccess: async () => {
    for (const f of ['dist/node.js', 'dist/node.d.ts']) {
      const s = readFileSync(f, 'utf8')
      const fixed = s.replace(/(from\s*)(['"])sqlite\2/g, '$1$2node:sqlite$2')
      if (fixed !== s) writeFileSync(f, fixed)
    }
  },
})
