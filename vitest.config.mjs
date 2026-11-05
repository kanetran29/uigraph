// Root vitest config: keep vitest's default excludes and skip the gitignored copies of the
// repository that workflow worktrees leave under .claude/worktrees, whose stale tests otherwise fail.
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({ test: { exclude: [...configDefaults.exclude, '.claude/**'] } })
