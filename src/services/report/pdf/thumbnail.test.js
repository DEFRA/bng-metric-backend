/**
 * The parcel thumbnails, and the one thing about them that does not show up in
 * the picture: how much geometry they write.
 *
 * A thumbnail is clipped to its own 18 mm square, so drawing a parcel from the
 * far side of the site adds nothing a reader can see — but it still writes
 * every vertex into the content stream before the clip discards it. Drawn
 * unconditionally that made the whole document quadratic in geometry, which is
 * invisible on a two-parcel fixture and ruinous on a real survey.
 */

import { describe, expect, test } from 'vitest'

import { buildSiteReportPdf } from './document.js'
import { envelopesOverlap } from './envelope.js'
import { toBuffer } from '../build-site-report.js'
import { baselineSite } from '../site-model.test-fixtures.js'

const PARCEL_VERTICES = 400
const PARCEL_RADIUS = 20

/** A jagged ring, as a surveyed boundary actually is rather than a rectangle. */
function jaggedParcel(centreX, centreY) {
  const ring = []
  for (let i = 0; i < PARCEL_VERTICES; i++) {
    const angle = (i / PARCEL_VERTICES) * Math.PI * 2
    const radius = PARCEL_RADIUS + (i % 7) * 0.3
    ring.push([
      centreX + Math.cos(angle) * radius,
      centreY + Math.sin(angle) * radius
    ])
  }
  ring.push(ring[0])
  return { type: 'MultiPolygon', coordinates: [[ring]] }
}

/**
 * The same ten parcels, the same total geometry, at two spacings: touching, so
 * every thumbnail genuinely shows its neighbours, and a kilometre apart, so
 * none of them can.
 */
async function documentSize(spacing) {
  const site = baselineSite()
  const properties = site.layers.habitats[0].properties
  site.layers.habitats = Array.from({ length: 10 }, (_, index) => ({
    properties: { ...properties, ref: `A${index}` },
    geometry: jaggedParcel(412_000 + index * spacing, 287_000)
  }))
  site.layers.hedgerows = []
  site.layers.watercourses = []
  site.layers.trees = []

  const { doc } = await buildSiteReportPdf({ baseline: site })
  return (await toBuffer(doc)).length
}

describe('#envelopesOverlap', () => {
  test('is true for boxes that share ground', () => {
    const frame = { minX: 0, minY: 0, maxX: 10, maxY: 10 }

    expect(
      envelopesOverlap({ minX: 5, minY: 5, maxX: 15, maxY: 15 }, frame)
    ).toBe(true)
    // Wholly inside, and wholly containing, both count.
    expect(
      envelopesOverlap({ minX: 2, minY: 2, maxX: 3, maxY: 3 }, frame)
    ).toBe(true)
    expect(
      envelopesOverlap({ minX: -5, minY: -5, maxX: 50, maxY: 50 }, frame)
    ).toBe(true)
  })

  test('counts a shared edge as overlapping', () => {
    // A parcel whose edge lies exactly on the frame's draws a visible line on
    // it, so excluding it would change the picture.
    expect(
      envelopesOverlap(
        { minX: 10, minY: 0, maxX: 20, maxY: 10 },
        { minX: 0, minY: 0, maxX: 10, maxY: 10 }
      )
    ).toBe(true)
  })

  test('is false for boxes that miss each other on either axis', () => {
    const frame = { minX: 0, minY: 0, maxX: 10, maxY: 10 }

    expect(
      envelopesOverlap({ minX: 11, minY: 0, maxX: 20, maxY: 10 }, frame)
    ).toBe(false)
    expect(
      envelopesOverlap({ minX: 0, minY: 11, maxX: 10, maxY: 20 }, frame)
    ).toBe(false)
  })
})

describe('the thumbnail context layer', () => {
  test('writes no geometry for parcels that cannot appear in the frame', async () => {
    const touching = await documentSize(40)
    const farApart = await documentSize(1000)

    // Same parcels, same count, same vertices — the only difference is whether
    // a thumbnail's neighbours are inside its frame. Drawn unconditionally the
    // two documents would be the same size, with the spread-out one paying for
    // ten copies of geometry the clip then throws away.
    expect(farApart).toBeLessThan(touching)
  })

  test('still draws the neighbours that are in frame', async () => {
    // The other direction of the same assertion, stated on purpose: the
    // context layer is what makes an 18 mm square legible, so the filter must
    // not have quietly removed it.
    expect(await documentSize(40)).toBeGreaterThan(await documentSize(1000))
  })
})
