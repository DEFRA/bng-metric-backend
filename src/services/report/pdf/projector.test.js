import { describe, expect, test } from 'vitest'

import { fitEnvelopeToFrame, makeProjector, projectorFor } from './projector.js'

const FRAME = { x: 40, y: 60, width: 400, height: 300 }

// A square-ish site somewhere in the Midlands, in EPSG:27700 metres.
const SITE = { minX: 412000, minY: 287000, maxX: 412400, maxY: 287300 }

const TOLERANCE = 1e-9

describe('#makeProjector', () => {
  test('maps extent corners onto frame corners', () => {
    const projector = makeProjector(SITE, FRAME)

    expect(projector.toPage(SITE.minX, SITE.maxY)).toEqual([FRAME.x, FRAME.y])
    expect(projector.toPage(SITE.maxX, SITE.minY)).toEqual([
      FRAME.x + FRAME.width,
      FRAME.y + FRAME.height
    ])
  })

  test('inverts northing, because pdfkit user space runs y downward', () => {
    const projector = makeProjector(SITE, FRAME)
    const [, highY] = projector.toPage(SITE.minX, SITE.maxY)
    const [, lowY] = projector.toPage(SITE.minX, SITE.minY)

    expect(highY).toBeLessThan(lowY)
  })

  test('shares one scale between x and y, so nothing is stretched', () => {
    const projector = makeProjector(SITE, FRAME)

    const eastwards = projector.toPage(SITE.minX + 100, SITE.maxY)[0] - FRAME.x
    const northwards =
      FRAME.y + FRAME.height - projector.toPage(SITE.minX, SITE.minY + 100)[1]

    expect(Math.abs(eastwards - northwards)).toBeLessThan(TOLERANCE)
    expect(projector.metresToPoints(100)).toBe(eastwards)
  })

  test('rejects a mismatched aspect rather than silently squashing it', () => {
    // This is the failure the module exists to prevent: unequal x/y scales are
    // what make geometry drift against the basemap.
    expect(() =>
      makeProjector({ minX: 0, minY: 0, maxX: 1000, maxY: 100 }, FRAME)
    ).toThrow(/does not match frame aspect/)
  })
})

describe('#fitEnvelopeToFrame', () => {
  test('matches the frame aspect exactly', () => {
    const wide = { minX: 0, minY: 0, maxX: 1000, maxY: 100 }
    const fitted = fitEnvelopeToFrame(wide, FRAME)

    const fittedAspect =
      (fitted.maxX - fitted.minX) / (fitted.maxY - fitted.minY)
    expect(Math.abs(fittedAspect - FRAME.width / FRAME.height)).toBeLessThan(
      TOLERANCE
    )
  })

  test('grows, never crops', () => {
    const envelopes = [
      { minX: 0, minY: 0, maxX: 1000, maxY: 100 },
      { minX: 0, minY: 0, maxX: 100, maxY: 1000 }
    ]

    for (const envelope of envelopes) {
      const fitted = fitEnvelopeToFrame(envelope, FRAME)
      expect(fitted.minX).toBeLessThanOrEqual(envelope.minX)
      expect(fitted.minY).toBeLessThanOrEqual(envelope.minY)
      expect(fitted.maxX).toBeGreaterThanOrEqual(envelope.maxX)
      expect(fitted.maxY).toBeGreaterThanOrEqual(envelope.maxY)
    }
  })

  test('keeps the site centred while it grows', () => {
    const tall = { minX: 0, minY: 0, maxX: 100, maxY: 1000 }
    const fitted = fitEnvelopeToFrame(tall, FRAME)

    const fittedCentre = (fitted.minX + fitted.maxX) / 2
    const originalCentre = (tall.minX + tall.maxX) / 2
    expect(Math.abs(fittedCentre - originalCentre)).toBeLessThan(TOLERANCE)
  })

  test('rejects a degenerate envelope with a message that says what to do', () => {
    expect(() =>
      fitEnvelopeToFrame({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, FRAME)
    ).toThrow(/degenerate/)
  })
})

describe('#projectorFor', () => {
  test('pads, squares and builds in one step', () => {
    const projector = projectorFor(SITE, FRAME, { pad: 0.1 })

    expect(projector.extent.minX).toBeLessThan(SITE.minX)
    expect(projector.extent.maxY).toBeGreaterThan(SITE.maxY)
    expect(
      projector.toPage(projector.extent.minX, projector.extent.maxY)
    ).toEqual([FRAME.x, FRAME.y])
  })
})
