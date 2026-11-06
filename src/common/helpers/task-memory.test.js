import { afterEach, describe, expect, test, vi } from 'vitest'
import { totalmem } from 'node:os'

import { taskMemoryBytes } from './task-memory.js'

const GIB = 1024 * 1024 * 1024

describe('#taskMemoryBytes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('uses a real container limit', () => {
    const limit = Math.floor(totalmem() / 2)
    vi.spyOn(process, 'constrainedMemory').mockReturnValue(limit)

    expect(taskMemoryBytes()).toBe(limit)
  })

  test('falls back to the machine when there is no limit', () => {
    vi.spyOn(process, 'constrainedMemory').mockReturnValue(0)

    expect(taskMemoryBytes()).toBe(totalmem())
  })

  test.each([
    ['UINT64_MAX, as seen in perf-test', 2 ** 64],
    ['the cgroup v1 no-limit value', 0x7ffffffffffff000],
    ['anything above the machine', totalmem() + GIB]
  ])('treats %s as no limit', (_name, sentinel) => {
    vi.spyOn(process, 'constrainedMemory').mockReturnValue(sentinel)

    expect(taskMemoryBytes()).toBe(totalmem())
  })
})
