import tseslint from 'typescript-eslint'

// Lightweight (non-type-checked) lint over the workspace source. Sample apps,
// the dashboard, and build output are excluded; they have their own concerns.
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.vite/**',
      'examples/**',
      'apps/dashboard/**',
      '**/.claude/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
