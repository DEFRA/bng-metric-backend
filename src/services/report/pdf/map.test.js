/**
 * Drawing, checked at the only level that is meaningful without rendering an
 * image: what the map module asks pdfkit to do, and where.
 *
 * The rule the module enforces — that NOTHING is positioned except through
 * `projector.toPage` — is what these assert. A recorded call carrying a page
 * coordinate the projector would not produce is a registration bug.
 */

import { describe, expect, test, vi } from 'vitest'

import {
  HABITAT_STYLES,
  drawGeometry,
  drawGraticule,
  drawScaleBar,
  fetchTiles,
  withFrameClip
} from './map.js'
import { makeProjector } from './projector.js'
import { TEST_GRID } from './synthetic-tiles.test-fixtures.js'

const FRAME = { x: 0, y: 0, width: 100, height: 100 }
const EXTENT = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }

function projector() {
  return makeProjector(EXTENT, FRAME)
}

/**
 * A pdfkit stand-in that records the calls a drawing makes. Every method
 * returns the document, because pdfkit's API chains.
 */
function fakeDoc() {
  const calls = []
  const methods = [
    'save',
    'restore',
    'rect',
    'clip',
    'moveTo',
    'lineTo',
    'closePath',
    'circle',
    'fill',
    'stroke',
    'fillAndStroke',
    'fillColor',
    'fillOpacity',
    'strokeColor',
    'lineWidth',
    'dash',
    'undash',
    'image',
    'fontSize',
    'text'
  ]

  const doc = { calls }
  for (const name of methods) {
    doc[name] = vi.fn((...args) => {
      calls.push([name, ...args])
      return doc
    })
  }
  return doc
}

function callsNamed(doc, name) {
  return doc.calls.filter(([called]) => called === name)
}

describe('#drawGeometry', () => {
  test('traces a polygon ring through the projector, and closes it', () => {
    const doc = fakeDoc()
    const proj = projector()

    drawGeometry(
      doc,
      {
        type: 'Polygon',
        coordinates: [
          [
            [0, 1000],
            [1000, 1000],
            [1000, 0],
            [0, 1000]
          ]
        ]
      },
      proj,
      HABITAT_STYLES.baseline
    )

    // The north-west corner of the extent is the top-left of the frame.
    expect(callsNamed(doc, 'moveTo')[0]).toEqual(['moveTo', 0, 0])
    expect(callsNamed(doc, 'lineTo')[0]).toEqual(['lineTo', 100, 0])
    expect(callsNamed(doc, 'closePath').length).toBe(1)
    // Fill and stroke together, even-odd so holes render as holes.
    expect(doc.fillAndStroke).toHaveBeenCalledWith(
      undefined,
      undefined,
      'even-odd'
    )
  })

  test('draws each polygon of a multipolygon separately', () => {
    const doc = fakeDoc()
    const square = [
      [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 0]
      ]
    ]

    drawGeometry(
      doc,
      { type: 'MultiPolygon', coordinates: [square, square] },
      projector(),
      HABITAT_STYLES.baseline
    )

    expect(callsNamed(doc, 'closePath').length).toBe(2)
  })

  test('strokes lines without filling them', () => {
    const doc = fakeDoc()

    drawGeometry(
      doc,
      {
        type: 'LineString',
        coordinates: [
          [0, 1000],
          [1000, 1000]
        ]
      },
      projector(),
      HABITAT_STYLES.hedgerow
    )

    expect(doc.stroke).toHaveBeenCalled()
    expect(doc.fill).not.toHaveBeenCalled()
    expect(doc.strokeColor).toHaveBeenCalledWith(HABITAT_STYLES.hedgerow.stroke)
  })

  test('draws each line of a multilinestring', () => {
    const doc = fakeDoc()
    const line = [
      [0, 1000],
      [1000, 1000]
    ]

    drawGeometry(
      doc,
      { type: 'MultiLineString', coordinates: [line, line] },
      projector(),
      HABITAT_STYLES.watercourse
    )

    expect(callsNamed(doc, 'stroke').length).toBe(2)
  })

  test('draws points as circles at the projected position', () => {
    const doc = fakeDoc()

    drawGeometry(
      doc,
      { type: 'MultiPoint', coordinates: [[500, 500]] },
      projector(),
      HABITAT_STYLES.tree
    )

    expect(doc.circle).toHaveBeenCalledWith(50, 50, HABITAT_STYLES.tree.radius)
  })

  test('descends into a geometry collection', () => {
    const doc = fakeDoc()

    drawGeometry(
      doc,
      {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [500, 500] },
          { type: 'Point', coordinates: [250, 250] }
        ]
      },
      projector(),
      HABITAT_STYLES.tree
    )

    expect(callsNamed(doc, 'circle').length).toBe(2)
  })

  test('applies and then clears a dash, so it cannot leak into the next shape', () => {
    const doc = fakeDoc()

    drawGeometry(
      doc,
      {
        type: 'LineString',
        coordinates: [
          [0, 1000],
          [1000, 1000]
        ]
      },
      projector(),
      { stroke: '#000000', dash: [2, 2] }
    )

    expect(doc.dash).toHaveBeenCalledWith(2, { space: 2 })
    expect(doc.undash).toHaveBeenCalled()
  })

  test('does nothing at all with no geometry', () => {
    const doc = fakeDoc()

    drawGeometry(doc, null, projector(), HABITAT_STYLES.baseline)

    expect(doc.calls).toEqual([])
  })

  test('refuses a geometry type it cannot draw rather than skipping it', () => {
    // Silently drawing nothing would put a parcel on the page that is not
    // there, which is worse than a failed report.
    const doc = fakeDoc()

    expect(() =>
      drawGeometry(doc, { type: 'Triangle' }, projector(), {})
    ).toThrow(/Cannot draw geometry type Triangle/)
  })
})

describe('#withFrameClip', () => {
  test('clips to the frame and restores the graphics state afterwards', () => {
    const doc = fakeDoc()

    withFrameClip(doc, FRAME, () => doc.stroke())

    expect(doc.rect).toHaveBeenCalledWith(0, 0, 100, 100)
    expect(doc.clip).toHaveBeenCalled()
    expect(doc.calls.at(0)[0]).toBe('save')
    expect(doc.calls.at(-1)[0]).toBe('restore')
  })
})

describe('#drawScaleBar', () => {
  test('reports a round distance that the drawn bar really spans', () => {
    const doc = fakeDoc()
    const proj = projector()

    const { metres, width } = drawScaleBar(doc, proj, {
      x: 0,
      y: 0,
      maxWidth: 40
    })

    // 1/2/5 series, and never wider than asked for.
    expect([1, 2, 5, 10, 20, 50, 100, 200, 500]).toContain(metres)
    expect(width).toBeLessThanOrEqual(40)
    expect(proj.metresToPoints(metres)).toBe(width)
    expect(doc.text).toHaveBeenCalledWith(
      `${metres} m`,
      0,
      5,
      expect.objectContaining({ align: 'center' })
    )
  })
})

describe('#drawGraticule', () => {
  test('draws lines at round coordinates, through the projector', () => {
    const doc = fakeDoc()

    drawGraticule(doc, projector(), 500)

    // Eastings 0, 500, 1000 → page x 0, 50, 100.
    const verticals = callsNamed(doc, 'moveTo').map(([, x]) => x)
    expect(verticals).toEqual(expect.arrayContaining([0, 50, 100]))
    expect(doc.dash).toHaveBeenCalled()
    expect(doc.undash).toHaveBeenCalled()
  })
})

describe('#fetchTiles', () => {
  test('fetches every covering tile before any drawing happens', async () => {
    // Sequencing, not speed: an await in the middle of drawing lets other work
    // interleave and silently corrupts both layout and reading order.
    const source = vi.fn(async (_grid, z, col, row) => ({
      png: Buffer.from(`${z}/${col}/${row}`)
    }))

    const { tiles } = await fetchTiles(
      TEST_GRID,
      9,
      { minX: 412000, minY: 287000, maxX: 412400, maxY: 287300 },
      source
    )

    expect(tiles.size).toBeGreaterThan(0)
    expect(source).toHaveBeenCalledTimes(tiles.size)
    for (const key of tiles.keys()) {
      expect(key).toMatch(/^9\/\d+\/\d+$/)
    }
  })
})
