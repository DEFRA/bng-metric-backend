/**
 * Ordnance Survey's own colours and widths for the ngd-base vector basemap.
 *
 * The data is in `ngd-light-style.json`, machine-extracted from OS's published
 * GL style for the `light-27700` tileset and committed so builds and tests need
 * no network. Regenerate it with `npm run extract:ngd-style`; the diff IS the
 * review. `tools/extract-ngd-style.js` says exactly what is kept and dropped,
 * and the JSON carries its own provenance — source URL, fetch date and the
 * number of style rules it came from.
 *
 * It lives as JSON rather than as a JS literal because that is what it is:
 * 43 draw passes of colours, widths and zoom stops, with no logic anywhere in
 * it. As source it read as a 2400-line module and drew a static-analysis
 * finding for every number in a colour ramp — nine hundred of them, none
 * meaningful, all in a file nobody should hand-edit.
 *
 * Each pass paints one tile layer in one mode, in OS's own draw order:
 *   { layer, fill }    every feature, one colour
 *   { layer, fills }   colour chosen by the feature's _symbol; absent
 *                      symbols are pattern overlays and are skipped
 *   { layer, line }    every feature, one stroke
 *   { layer, lines }   stroke chosen by _symbol; widthStops are the style's
 *                      [zoom, px] ramp (see lineWidthAtZoom in vector-style.js)
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

const STYLE_PATH = path.resolve(import.meta.dirname, 'ngd-light-style.json')

// Read rather than `import … with { type: 'json' }`: the import-attribute
// syntax is fine for Node 24 but neostandard's parser rejects it, and changing
// the repo's parser settings for one import is a poor trade. Read once, at
// import, like the bundled fonts in services/report/fonts.js — the file ships
// inside src/ and is as present as the module that reads it.
export const NGD_LIGHT_BASEMAP_PASSES = JSON.parse(
  readFileSync(STYLE_PATH, 'utf8')
).passes
