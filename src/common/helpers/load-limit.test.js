import { afterEach, describe, expect, test, vi } from 'vitest'

import { config } from '../../config.js'
import { loadOptions } from './load-limit.js'

const mockWarn = vi.hoisted(() => vi.fn())

vi.mock('./logging/logger.js', () => ({
  createLogger: () => ({ warn: mockWarn })
}))

describe('#loadOptions', () => {
  const original = {
    maxRssBytes: config.get('validation.maxRssBytes'),
    cdpEnvironment: config.get('cdpEnvironment')
  }

  afterEach(() => {
    config.set('validation.maxRssBytes', original.maxRssBytes)
    config.set('cdpEnvironment', original.cdpEnvironment)
  })

  test('sets the RSS ceiling and its sample interval when configured', () => {
    config.set('validation.maxRssBytes', 1024)

    expect(loadOptions()).toEqual({
      maxRssBytes: 1024,
      sampleInterval: config.get('validation.loadSampleIntervalMs')
    })
    expect(mockWarn).not.toHaveBeenCalled()
  })

  test('warns in a deployed environment when the ceiling is off', () => {
    config.set('validation.maxRssBytes', 0)
    config.set('cdpEnvironment', 'prod')

    expect(loadOptions()).toEqual({})
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('VALIDATION_MAX_RSS_BYTES is not set')
    )
  })

  test('stays quiet locally when the ceiling is off', () => {
    config.set('validation.maxRssBytes', 0)
    config.set('cdpEnvironment', 'local')

    expect(loadOptions()).toEqual({})
    expect(mockWarn).not.toHaveBeenCalled()
  })
})
