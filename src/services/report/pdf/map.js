/**
 * Drawing a map frame into a pdfkit document.
 *
 * The rule this module enforces: NOTHING is positioned except by
 * `projector.toPage`. Basemap tiles included — a tile's ground corner goes
 * through the same call a habitat vertex does. That is what makes the overlay
 * land correctly, and it is why there is no nudge factor anywhere below.
 */

import { tileSpanMetres, tilesCovering, tileTopLeft } from './grid.js'
import { largestStepAtMost } from './nice-numbers.js'

/**
 * Tiles are drawn a whisker larger than their true size.
 *
 * Tile edges rarely land on exact device pixels, so abutting tiles can leave a
 * sub-pixel light seam where the rasteriser rounds both sides away from the
 * join. Overdrawing by a fraction of a point makes neighbours overlap instead.
 * It does NOT affect registration: each tile's top-left stays exactly where
 * the projector puts it, and only the bottom/right edges grow.
 */
const TILE_OVERDRAW_POINTS = 0.4

/** pdfkit defaults when a style leaves them out. */
const DEFAULT_FILL_OPACITY = 1
const DEFAULT_POLYGON_LINE_WIDTH = 0.6
const DEFAULT_STROKE_LINE_WIDTH = 1
const DEFAULT_POINT_RADIUS = 2

export const HABITAT_STYLES = {
  baseline: { fill: '#4a7c59', stroke: '#2b4a34', fillOpacity: 0.55 },
  postIntervention: { fill: '#7f5aa8', stroke: '#4c356a', fillOpacity: 0.55 },
  redLine: { stroke: '#d4351c', lineWidth: 1.6, dash: null },
  hedgerow: { stroke: '#00703c', lineWidth: 2 },
  watercourse: { stroke: '#1d70b8', lineWidth: 2 },
  tree: { fill: '#0b4b2c', radius: 2 }
}

const INK = '#0b0c0c'

const GRATICULE_LINE_WIDTH = 0.4
const GRATICULE_DASH_POINTS = 2

const DEFAULT_SCALE_BAR_WIDTH = 120
const SCALE_BAR_LINE_WIDTH = 1
const SCALE_BAR_HEIGHT = 3
const SCALE_BAR_FONT_SIZE = 6.5
const SCALE_BAR_LABEL_GAP = 5
/** Run `draw` with the map frame as a clipping region. */
export function withFrameClip(doc, frame, draw) {
  doc.save()
  doc.rect(frame.x, frame.y, frame.width, frame.height).clip()
  draw()
  doc.restore()
}

/**
 * Fetch every tile a frame needs, before any drawing starts.
 *
 * Drawing into a pdfkit document is sequential and stateful: the cursor, the
 * current page and — for a tagged PDF — the marked-content sequence all depend
 * on call order. An `await` in the middle of drawing lets other work interleave
 * and silently corrupts both the layout and the reading order. So all I/O
 * happens here, and every draw function below is synchronous.
 *
 * @param {object} grid
 * @param {number} z
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} extent
 * @param {(grid: object, z: number, col: number, row: number) => Promise<{png: Buffer}>} tileSource
 * @returns {Promise<{ tiles: Map<string, {png: Buffer}> }>}
 */
export async function fetchTiles(grid, z, extent, tileSource) {
  const wanted = tilesCovering(grid, z, extent)
  const fetched = await Promise.all(
    wanted.map(async ({ col, row }) => [
      `${z}/${col}/${row}`,
      await tileSource(grid, z, col, row)
    ])
  )

  return { tiles: new Map(fetched) }
}

/**
 * Paint the basemap by placing each covering tile at its own ground position.
 *
 * @returns {{ tileCount:number, z:number }}
 */
export function drawBasemap(doc, { grid, z, projector, tiles }) {
  const span = tileSpanMetres(grid, z)
  const size = projector.metresToPoints(span) + TILE_OVERDRAW_POINTS
  const covering = tilesCovering(grid, z, projector.extent)

  for (const { col, row } of covering) {
    const [worldX, worldY] = tileTopLeft(grid, z, col, row)
    // The one and only positioning call. Same function as the geometry uses.
    const [x, y] = projector.toPage(worldX, worldY)

    const tile = tiles.get(`${z}/${col}/${row}`)
    if (tile) {
      doc.image(tile.png, x, y, { width: size, height: size })
    }
  }

  return { tileCount: covering.length, z }
}

/** Trace a ring (array of [E, N]) as a closed path. */
function traceRing(doc, ring, projector) {
  ring.forEach((coordinate, index) => {
    const [x, y] = projector.toPage(coordinate[0], coordinate[1])
    if (index === 0) {
      doc.moveTo(x, y)
    } else {
      doc.lineTo(x, y)
    }
  })
  doc.closePath()
}

function tracePolygon(doc, rings, projector) {
  // Exterior ring plus any holes; pdfkit fills with the even-odd rule when
  // asked, which is what makes holes render as holes.
  for (const ring of rings) {
    traceRing(doc, ring, projector)
  }
}

function traceLine(doc, line, projector) {
  line.forEach((coordinate, index) => {
    const [x, y] = projector.toPage(coordinate[0], coordinate[1])
    if (index === 0) {
      doc.moveTo(x, y)
    } else {
      doc.lineTo(x, y)
    }
  })
}

/**
 * Draw any GeoJSON geometry through the projector.
 *
 * Stroke widths are in points and set outside the coordinate maths, so they
 * stay constant whatever the map scale — the reason this uses an explicit
 * `toPage` per vertex rather than pushing the transform into pdfkit's CTM.
 */
export function drawGeometry(doc, geometry, projector, style) {
  if (!geometry) {
    return
  }

  const draw = GEOMETRY_PAINTERS.get(geometry.type)
  if (!draw) {
    // Silently drawing nothing would put a parcel on the page that is not
    // there, which is worse than a failed report.
    throw new Error(`Cannot draw geometry type ${geometry.type}`)
  }
  draw(doc, geometry, projector, style)
}

/**
 * One painter per GeoJSON type. A lookup rather than a switch so that adding a
 * type is a single entry, and so the multi- forms are visibly nothing more than
 * their singular counterpart applied to each member.
 *
 * A Map rather than an object literal because the key is untrusted: geometry
 * arrives from the database as parsed JSON, and `PAINTERS[geometry.type]` on a
 * plain object would resolve `'constructor'` to a function and call it.
 */
const GEOMETRY_PAINTERS = new Map([
  [
    'Polygon',
    (doc, geometry, projector, style) =>
      paintPolygon(doc, geometry.coordinates, projector, style)
  ],
  [
    'MultiPolygon',
    (doc, geometry, projector, style) => {
      for (const polygon of geometry.coordinates) {
        paintPolygon(doc, polygon, projector, style)
      }
    }
  ],
  [
    'LineString',
    (doc, geometry, projector, style) =>
      paintLine(doc, geometry.coordinates, projector, style)
  ],
  [
    'MultiLineString',
    (doc, geometry, projector, style) => {
      for (const line of geometry.coordinates) {
        paintLine(doc, line, projector, style)
      }
    }
  ],
  [
    'Point',
    (doc, geometry, projector, style) =>
      drawPoint(doc, geometry.coordinates, projector, style)
  ],
  [
    'MultiPoint',
    (doc, geometry, projector, style) => {
      for (const point of geometry.coordinates) {
        drawPoint(doc, point, projector, style)
      }
    }
  ],
  [
    'GeometryCollection',
    (doc, geometry, projector, style) => {
      for (const child of geometry.geometries) {
        drawGeometry(doc, child, projector, style)
      }
    }
  ]
])

function paintPolygon(doc, rings, projector, style) {
  doc.save()
  tracePolygon(doc, rings, projector)
  paint(doc, style)
  doc.restore()
}

function paintLine(doc, line, projector, style) {
  doc.save()
  traceLine(doc, line, projector)
  strokeOnly(doc, style)
  doc.restore()
}

function drawPoint(doc, [easting, northing], projector, style) {
  const [x, y] = projector.toPage(easting, northing)
  doc.save()
  doc.circle(x, y, style.radius ?? DEFAULT_POINT_RADIUS)
  doc.fillColor(style.fill ?? '#000000')
  doc.fill()
  doc.restore()
}

function paint(doc, style) {
  if (style.fill && style.stroke) {
    doc.fillColor(style.fill)
    doc.fillOpacity(style.fillOpacity ?? DEFAULT_FILL_OPACITY)
    doc.strokeColor(style.stroke)
    doc.lineWidth(style.lineWidth ?? DEFAULT_POLYGON_LINE_WIDTH)
    doc.fillAndStroke(undefined, undefined, 'even-odd')
    return
  }
  if (style.fill) {
    doc.fillColor(style.fill)
    doc.fillOpacity(style.fillOpacity ?? DEFAULT_FILL_OPACITY)
    doc.fill('even-odd')
    return
  }
  strokeOnly(doc, style)
}

function strokeOnly(doc, style) {
  doc.strokeColor(style.stroke ?? '#000000')
  doc.lineWidth(style.lineWidth ?? DEFAULT_STROKE_LINE_WIDTH)
  if (style.dash) {
    doc.dash(style.dash[0], { space: style.dash[1] })
  }
  doc.stroke()
  if (style.dash) {
    doc.undash()
  }
}

/**
 * Draw the vector graticule that proves registration.
 *
 * These lines are drawn at round EPSG:27700 coordinates through the projector.
 * The synthetic basemap draws its own lines at the SAME round coordinates, in
 * tile pixel space. If the transform is correct the two coincide exactly; if
 * it is wrong by even a metre the doubling is obvious at print size.
 *
 * Against a real OS basemap the equivalent check is the 1 km National Grid,
 * which OS renders itself.
 */
export function drawGraticule(doc, projector, intervalMetres, style = {}) {
  const { extent } = projector
  doc.save()
  doc.strokeColor(style.stroke ?? HABITAT_STYLES.redLine.stroke)
  doc.lineWidth(style.lineWidth ?? GRATICULE_LINE_WIDTH)
  doc.dash(GRATICULE_DASH_POINTS, { space: GRATICULE_DASH_POINTS })

  for (
    let x = Math.ceil(extent.minX / intervalMetres) * intervalMetres;
    x <= extent.maxX;
    x += intervalMetres
  ) {
    const [px, top] = projector.toPage(x, extent.maxY)
    const [, bottom] = projector.toPage(x, extent.minY)
    doc.moveTo(px, top).lineTo(px, bottom)
  }
  for (
    let y = Math.ceil(extent.minY / intervalMetres) * intervalMetres;
    y <= extent.maxY;
    y += intervalMetres
  ) {
    const [left, py] = projector.toPage(extent.minX, y)
    const [right] = projector.toPage(extent.maxX, y)
    doc.moveTo(left, py).lineTo(right, py)
  }

  doc.stroke()
  doc.undash()
  doc.restore()
}

/** A scale bar, sized from the projector so it is always truthful. */
export function drawScaleBar(
  doc,
  projector,
  { x, y, maxWidth = DEFAULT_SCALE_BAR_WIDTH }
) {
  const metres = largestStepAtMost(projector.pointsToMetres(maxWidth))

  const width = projector.metresToPoints(metres)
  doc.save()
  doc.lineWidth(SCALE_BAR_LINE_WIDTH).strokeColor(INK).fillColor(INK)
  doc.rect(x, y, width, SCALE_BAR_HEIGHT).fill(INK)
  doc
    .fontSize(SCALE_BAR_FONT_SIZE)
    .text(`${metres} m`, x, y + SCALE_BAR_LABEL_GAP, {
      width,
      align: 'center'
    })
  doc.restore()
  return { metres, width }
}
