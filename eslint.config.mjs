import tseslint from 'typescript-eslint'

// Lightweight (non-type-checked) lint over the workspace source. Sample apps,
// the dashboard, and build output are excluded; they have their own concerns.
// So is the thesis evaluation harness: those are one-off measurement scripts that
// are checked by reproducing their numbers, not by this config's rules.
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.vite/**',
      'examples/**',
      '**/test-fixtures/**',
      'apps/dashboard/**',
      '**/.claude/**',
      'thesis-handoff/**',
      'Claude outputs/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
