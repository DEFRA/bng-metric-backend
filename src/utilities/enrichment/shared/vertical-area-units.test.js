import { describe, expect, it, vi } from 'vitest'

import { verticalAreaFaceAreaMissing } from './vertical-area-units.js'

const PREFIX = 'test: '

describe('verticalAreaFaceAreaMissing', () => {
  it('accepts a positive finite face area silently', () => {
    const logger = { warn: vi.fn() }

    expect(
      verticalAreaFaceAreaMissing(
        { featureId: 'f-1', area: 150 },
        logger,
        PREFIX
      )
    ).toBe(false)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', {}],
    ['null', { area: null }],
    ['zero', { area: 0 }],
    ['negative', { area: -5 }],
    ['NaN', { area: Number.NaN }],
    ['a string', { area: '150' }]
  ])(
    'logs a note and reports missing when the area is %s',
    (_label, feature) => {
      const logger = { warn: vi.fn() }

      expect(
        verticalAreaFaceAreaMissing(
          { featureId: 'f-1', ...feature },
          logger,
          PREFIX
        )
      ).toBe(true)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'test: Vertical area habitat featureId f-1 has no usable hand-entered face Area'
        )
      )
    }
  )

  it('labels a feature without an id as unknown', () => {
    const logger = { warn: vi.fn() }

    verticalAreaFaceAreaMissing({}, logger, PREFIX)

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('featureId unknown')
    )
  })
})
