// How many test workers a heavy step may start, sized by the RAM that is free now rather than by a
// fixed cap: a fixed two left a 24 GB machine mostly idle, and a fixed thirteen (vitest's default,
// cores - 1) in several agents at once exhausted it (JetsamEvent, 30 Oct and 1 Nov 2026).
import { execFileSync } from 'node:child_process'
import os from 'node:os'

/** Measured on 5 Nov 2026: the adapter suite held about 0.5-0.7 GB per vitest worker. */
const PER_WORKER_GB = 0.7
/** Left for the system and the applications already open. */
const RESERVE_GB = 6

/**
 * The worker count for `freeGB` of free RAM on a machine with `cores` cores: as many as fit above
 * the reserve, at least one, at most cores - 1. `env` (e.g. SWEEP_WORKERS) overrides it when it is
 * a positive integer.
 */
export function workersFor({ freeGB, cores, env, reserveGB = RESERVE_GB, perWorkerGB = PER_WORKER_GB }) {
  const forced = Number.parseInt(env ?? '', 10)
  if (Number.isInteger(forced) && forced > 0 && String(forced) === String(env).trim()) return forced
  const fit = Math.floor((freeGB - reserveGB) / perWorkerGB)
  return Math.max(1, Math.min(cores - 1, fit))
}

/**
 * Free RAM in GB as macOS reports it: memory_pressure's free percentage of the total, which counts
 * reclaimable memory; os.freemem() counts only idle pages and under-reports. Falls back to
 * os.freemem() where memory_pressure is absent.
 */
export function freeGB() {
  try {
    const out = execFileSync('memory_pressure', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const m = /free percentage:\s*(\d+)%/.exec(out)
    if (m) return (Number(m[1]) / 100) * (os.totalmem() / 2 ** 30)
  } catch {}
  return os.freemem() / 2 ** 30
}

/** The worker count for this machine now, honouring SWEEP_WORKERS. */
export function workersNow() {
  return workersFor({ freeGB: freeGB(), cores: os.cpus().length, env: process.env.SWEEP_WORKERS })
}
