import { describe, expect, it } from 'vitest'

import { config } from '../../../config.js'
import { validationPoolOptions } from './pool-options.js'

// The pool is a process-wide singleton built on first use, so two call sites
// passing different option sets meant whichever ran first silently decided how
// the other behaved — and the shorter list left the queue-wait and admission
// limits off entirely. One list is the fix; this asserts it stays complete,
// because a setting dropped from it fails nothing at all.
describe('validationPoolOptions', () => {
  it('carries every pool setting, so the two call sites cannot drift', () => {
    expect(validationPoolOptions()).toEqual({
      size: config.get('validation.workerCount'),
      queueLimit: config.get('validation.workerQueueLimit'),
      timeoutMs: config.get('validation.workerTimeoutMs'),
      queueWaitLimitMs: config.get('validation.queueWaitLimitMs'),
      admissionLimit: config.get('validation.admissionLimit')
    })
  })
})
