/**
 * The per-parcel mini-map, shared by both habitat layouts.
 *
 * A thumbnail is not a different kind of map from the site map on page 1 — it
 * is the same drawing against a smaller frame and a tighter extent. What it
 * adds is the muted context layer: at 18 mm square a lone polygon tells you the
 * parcel's shape but not where it sits, so its neighbours and the site boundary
 * are drawn faintly underneath.
 *
 * Extracted here so the table layout and the card layout cannot drift apart.
 * They differ in how big the frame is and what goes beside it, not in how the
 * map is drawn.
 */

import {
  HABITAT_STYLES,
  drawBasemap,
  drawGeometry,
  withFrameClip
} from './map.js'
import { envelopeOf, padEnvelope } from './envelope.js'
import { fitEnvelopeToFrame, makeProjector } from './projector.js'
import { fillGround, prepareBasemap } from './page-furniture.js'
import {
  BORDER,
  CONTEXT_FILL,
  CONTEXT_FILL_OPACITY,
  CONTEXT_LINE_WIDTH,
  CONTEXT_STROKE,
  MINI_MAP_PAD,
  RULE_WIDTH,
  SUBJECT_LINE_WIDTH,
  THUMBNAIL_TARGET_DPI
} from './layout.js'

/**
 * Work out each thumbnail's extent and fetch its tiles, before any drawing.
 *
 * All of it up front, because pdfkit's drawing is sequential and stateful and
 * an `await` in the middle of it silently corrupts both layout and reading
 * order. Every frame is the same size, so an extent — and therefore a tile set
 * — does not depend on where the parcel lands on the page.
 *
 * @param {object} options
 * @param {Array} options.features
 * @param {object} options.grid
 * @param {Function|null} options.tileSource
 * @param {boolean} options.withBasemap
 * @param {number} options.size  frame edge, in points
 * @returns {Promise<Map>} feature → { extent, z, tiles }
 */
async function prepareThumbnails({
  features,
  grid,
  tileSource,
  withBasemap,
  size
}) {
  const square = { x: 0, y: 0, width: size, height: size }
  const thumbnails = new Map()

  for (const feature of features) {
    const padded = padEnvelope(envelopeOf(feature.geometry), MINI_MAP_PAD)
    const extent = fitEnvelopeToFrame(padded, square)

    if (!withBasemap) {
      thumbnails.set(feature, { extent, z: null, tiles: null })
      continue
    }
    const basemapLayer = await prepareBasemap({
      grid,
      extent,
      tileSource,
      frameWidth: square.width,
      targetDpi: THUMBNAIL_TARGET_DPI
    })
    thumbnails.set(feature, { extent, ...basemapLayer })
  }
  return thumbnails
}

/**
 * A parcel thumbnail, zoomed to the parcel itself so its shape is legible.
 *
 * @returns {{ tileCount: number, projector: object }}
 */
function drawMiniMap({ doc, frame, feature, style, site, grid, thumbnail }) {
  // The extent was computed against an identically sized frame, so rebuilding
  // the projector here only moves the origin — the scale is unchanged.
  const projector = makeProjector(thumbnail.extent, frame)

  fillGround(doc, frame)

  let tileCount = 0
  withFrameClip(doc, frame, () => {
    if (thumbnail.tiles) {
      tileCount = drawBasemap(doc, {
        grid,
        z: thumbnail.z,
        projector,
        tiles: thumbnail.tiles
      }).tileCount
    }
    drawContext(doc, site, feature, projector)
    drawGeometry(doc, feature.geometry, projector, {
      ...style,
      lineWidth: SUBJECT_LINE_WIDTH
    })
  })

  doc.save().lineWidth(RULE_WIDTH.miniMapFrame).strokeColor(BORDER)
  doc.rect(frame.x, frame.y, frame.width, frame.height).stroke()
  doc.restore()

  return { tileCount, projector }
}

/** Neighbouring parcels and the site boundary, faintly, for orientation. */
function drawContext(doc, site, feature, projector) {
  for (const other of site.layers.habitats ?? []) {
    if (other !== feature) {
      drawGeometry(doc, other.geometry, projector, {
        fill: CONTEXT_FILL,
        stroke: CONTEXT_STROKE,
        fillOpacity: CONTEXT_FILL_OPACITY,
        lineWidth: CONTEXT_LINE_WIDTH
      })
    }
  }
  if (site.redLine) {
    drawGeometry(doc, site.redLine.geometry, projector, {
      stroke: HABITAT_STYLES.redLine.stroke,
      lineWidth: SUBJECT_LINE_WIDTH
    })
  }
}

export { drawMiniMap, prepareThumbnails }
