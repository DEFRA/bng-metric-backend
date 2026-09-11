import { afterEach, describe, expect, it, vi } from 'vitest'

import { logSizing, resolveWorkerCount } from './worker-pool.js'

/**
 * Held in a hoisted object, like `instance` below, so the suite keeps its own
 * reference to the very logger worker-pool.js captured at import time — the
 * module-level `createLogger()` runs once, and `restoreAllMocks` must not be
 * able to take the spies away from underneath it.
 */
const log = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }))

vi.mock('../../../common/helpers/logging/logger.js', () => ({
  createLogger: () => log
}))

/**
 * Sizing is tested apart from the rest of the pool because it is the one part
 * that reads the machine. Mocking `node:os` in the suite that drives real
 * worker threads would change what that suite is testing; here nothing spawns.
 */
const instance = vi.hoisted(() => ({ cores: 0, hostMemoryBytes: 0 }))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal()),
  availableParallelism: () => instance.cores,
  totalmem: () => instance.hostMemoryBytes
}))

const GB = 1024 * 1024 * 1024

/** Cores enough that the memory budget is always the binding one. */
const AMPLE_CORES = 64

/** Memory enough that the CPU budget is always the binding one. */
const AMPLE_MEMORY = 64 * GB

const AUTO = 0

/** Describe an instance to size a pool for. `taskMemoryBytes` is the cgroup limit. */
function given({ cores, hostMemoryBytes = AMPLE_MEMORY, taskMemoryBytes = 0 }) {
  instance.cores = cores
  instance.hostMemoryBytes = hostMemoryBytes
  vi.spyOn(process, 'constrainedMemory').mockReturnValue(taskMemoryBytes)
}

afterEach(() => {
  vi.restoreAllMocks()
  log.info.mockClear()
  log.warn.mockClear()
})

describe('resolveWorkerCount — auto-sizing', () => {
  it('uses every core but the one reserved for the main thread', () => {
    given({ cores: 4 })
    expect(resolveWorkerCount(AUTO)).toMatchObject({ size: 3, auto: true })
  })

  it('grows when the task is given more vCPU, with nothing to change by hand', () => {
    given({ cores: 2 })
    const small = resolveWorkerCount(AUTO).size
    given({ cores: 8 })
    expect(resolveWorkerCount(AUTO).size).toBeGreaterThan(small)
  })

  it('holds back to what the memory can carry, not what the cores could run', () => {
    given({ cores: AMPLE_CORES, hostMemoryBytes: 2 * GB })
    expect(resolveWorkerCount(AUTO)).toMatchObject({ size: 2, memoryBudget: 2 })
  })

  it('reproduces the sizing the docs give by hand', () => {
    // docs/geometry-validation.md: "At a 2 GB task that is comfortable; at 1 GB
    // it is one worker at most." Auto-sizing must not invent a second answer.
    given({ cores: AMPLE_CORES, hostMemoryBytes: 1 * GB })
    expect(resolveWorkerCount(AUTO).size).toBe(1)
    given({ cores: AMPLE_CORES, hostMemoryBytes: 2 * GB })
    expect(resolveWorkerCount(AUTO).size).toBe(2)
  })

  it('starts one worker on a single-core instance rather than none', () => {
    given({ cores: 1 })
    expect(resolveWorkerCount(AUTO).size).toBe(1)
  })
})

describe('resolveWorkerCount — an explicit setting', () => {
  it('is honoured when the instance can carry it', () => {
    given({ cores: 8 })
    expect(resolveWorkerCount(3)).toMatchObject({ size: 3, auto: false })
  })

  it('is capped by the cores available, as it always has been', () => {
    given({ cores: 2 })
    expect(resolveWorkerCount(1000).size).toBe(1)
  })

  it('is capped by the memory available, so it cannot OOM the task', () => {
    given({ cores: AMPLE_CORES, hostMemoryBytes: 1 * GB })
    expect(resolveWorkerCount(8).size).toBe(1)
  })

  it('auto-sizes on a nonsense value rather than starting a crippled pool', () => {
    given({ cores: 4 })
    expect(resolveWorkerCount(-5)).toMatchObject({ size: 3, auto: true })
  })
})

describe('resolveWorkerCount — a value that is not a number', () => {
  it('auto-sizes on a NaN rather than pinning the pool to no workers', () => {
    // A malformed VALIDATION_WORKER_COUNT must not be the difference between a
    // working instance and one that validates nothing.
    given({ cores: 4 })
    expect(resolveWorkerCount(Number.NaN)).toMatchObject({
      size: 3,
      auto: true
    })
  })
})

describe('resolveWorkerCount — which memory figure it believes', () => {
  it("prefers the container's limit over the host's RAM", () => {
    given({
      cores: AMPLE_CORES,
      hostMemoryBytes: 64 * GB,
      taskMemoryBytes: 1 * GB
    })
    expect(resolveWorkerCount(AUTO).size).toBe(1)
  })

  it('falls back to the host when the process is under no limit', () => {
    given({ cores: AMPLE_CORES, hostMemoryBytes: 2 * GB, taskMemoryBytes: 0 })
    expect(resolveWorkerCount(AUTO).size).toBe(2)
  })
})

describe('logSizing — which budget it reports as binding', () => {
  it('warns when memory holds the pool below the cores it was given', () => {
    // The provisioning mistake this exists to surface: vCPU the task has not
    // been given the memory to use.
    given({ cores: AMPLE_CORES, hostMemoryBytes: 1 * GB })
    const sizing = resolveWorkerCount(AUTO)

    logSizing(sizing.size, sizing)

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('by MEMORY, not cpu')
    )
    expect(log.info).not.toHaveBeenCalled()
  })

  it('logs at info when the cores are the binding budget', () => {
    given({ cores: 4 })
    const sizing = resolveWorkerCount(AUTO)

    logSizing(sizing.size, sizing)

    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('geos worker pool sized to 3 worker(s)')
    )
    expect(log.warn).not.toHaveBeenCalled()
  })
})
