/**
 * The pieces both page builders need: fonts, artifact marking, basemap
 * prefetch, and the ground a map is drawn on when there is no basemap.
 */

import path from 'node:path'

import { fetchTiles } from './map.js'
import { pickZoom } from './grid.js'
import { MAP_GROUND } from './layout.js'

/**
 * Embed the body fonts.
 *
 * PDF/UA 7.21.4.1 requires every font PROGRAM to be embedded. pdfkit's
 * defaults — Helvetica and friends — are the PDF base-14: they are referenced
 * by name and resolved by the viewer, never embedded, so a document using them
 * can never pass however well tagged it is. Nothing about the rendered page
 * looks different either way; only a conformance checker can see it.
 *
 * Noto Sans is used because it is SIL OFL 1.1 and therefore safe to commit.
 * GOV.UK sets GDS Transport in the browser and that is what this should
 * eventually embed; it is licensed for GOV.UK services but is not
 * redistributable here, so swapping it in is a licensing step, not a code
 * change — replace the two files in `assets/fonts` and the names below.
 */
const FONT_DIR = path.resolve(import.meta.dirname, '..', 'assets', 'fonts')
const BODY = 'Body'
const BOLD = 'Bold'

function registerFonts(doc) {
  doc.registerFont(BODY, path.join(FONT_DIR, 'NotoSans-Regular.ttf'))
  doc.registerFont(BOLD, path.join(FONT_DIR, 'NotoSans-Bold.ttf'))
  // pdfkit starts every document on Helvetica; without this, anything drawn
  // before the first explicit font() call would reintroduce the failure.
  doc.font(BODY)
}

/**
 * Mark drawing as an artifact — decoration that carries no information and
 * must be skipped by assistive technology. Tagged PDF requires that all
 * non-structure content be marked this way.
 */
function labelAsArtifact(doc, draw) {
  doc.markContent('Artifact', { type: 'Layout' })
  draw()
  doc.endMarkedContent()
}

/**
 * Choose a zoom and fetch every tile the frame needs, BEFORE any drawing.
 *
 * Separated from drawing on purpose: pdfkit is sequential and stateful, so an
 * `await` between marking a structure sequence and closing it lets other work
 * interleave and silently corrupts both the layout and the reading order.
 *
 * @returns {Promise<{ z: number, tiles: Map<string, {png: Buffer}> }>}
 */
async function prepareBasemap({
  grid,
  extent,
  tileSource,
  frameWidth,
  targetDpi
}) {
  const z = pickZoom(grid, extent, frameWidth, targetDpi)
  const { tiles } = await fetchTiles(grid, z, extent, tileSource)
  return { z, tiles }
}

/** The plain ground a map frame gets when there is no basemap behind it. */
function fillGround(doc, frame) {
  doc.save()
  doc.rect(frame.x, frame.y, frame.width, frame.height).fillColor(MAP_GROUND)
  doc.fill()
  doc.restore()
}

/**
 * "1 watercourse", not "1 watercourses".
 *
 * Trivial, and worth doing properly: this string is not decoration, it is what
 * a screen-reader user actually hears in place of the map. Automated
 * conformance checking cannot catch it — veraPDF confirms alt text EXISTS, not
 * that it reads well — which is precisely why a human pass is still required.
 */
function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export {
  BODY,
  BOLD,
  fillGround,
  labelAsArtifact,
  plural,
  prepareBasemap,
  registerFonts
}
