#!/usr/bin/env node
/**
 * Regenerate src/services/report/pdf/ngd-light-style.json from Ordnance
 * Survey's published style.
 *
 *   OS_API_KEY=… npm run extract:ngd-style
 *
 * The vector basemap's colours and widths must be OS's, not ours — but
 * interpreting the full GL style spec at draw time would be a rendering
 * engine. So this tool distils the style ONCE, into plain data the report
 * builder can consume, and the result is committed so builds and tests need
 * no network. Re-run it if OS revise the style; the diff IS the review.
 *
 * What it keeps: every `fill` and `line` rule with a literal colour, grouped
 * by source-layer and `_symbol` (the only filter attribute the style uses),
 * in the style's own draw order. Where one symbol has two line rules — road
 * casing under road fill — they become two passes, preserving that order.
 *
 * What it drops, deliberately: `symbol` (text/icon) and `circle` rules
 * (labels are omitted from the print basemap), and the handful of rules
 * whose colour is an expression rather than a literal (pattern overlays;
 * their base colour is painted by an earlier rule, so skipping loses a
 * texture, never a colour).
 */

import fs from 'node:fs'
import path from 'node:path'

const STYLE_URL =
  'https://api.os.uk/maps/vector/ngd/ota/v1/collections/ngd-base/styles/light-27700'
const OUT_PATH = path.resolve(
  import.meta.dirname,
  '..',
  'src',
  'services',
  'report',
  'pdf',
  'ngd-light-style.json'
)

function symbolsOf(filter) {
  const found = []
  const walk = (node) => {
    if (!Array.isArray(node)) {
      return
    }
    if ((node[0] === 'in' || node[0] === '==') && node[1] === '_symbol') {
      found.push(...node.slice(2))
    }
    for (const child of node) {
      walk(child)
    }
  }
  walk(filter)
  return found.length > 0 ? found : [null] // null = the rule has no symbol filter
}

function widthStopsOf(layer) {
  const width = layer.paint?.['line-width']
  if (typeof width === 'number') {
    return [[0, width]]
  }
  if (width?.stops) {
    return width.stops
  }
  return [[0, 1]]
}

function collectGroups(styleLayers) {
  // (source-layer | type | symbol | colour) → merged width stops + style order
  const groups = new Map()
  styleLayers.forEach((layer, order) => {
    if (layer.type !== 'fill' && layer.type !== 'line') {
      return
    }
    const colour =
      layer.type === 'fill'
        ? layer.paint?.['fill-color']
        : layer.paint?.['line-color']
    if (typeof colour !== 'string') {
      return
    }
    for (const symbol of symbolsOf(layer.filter)) {
      const key = JSON.stringify([
        layer['source-layer'],
        layer.type,
        symbol,
        colour
      ])
      if (!groups.has(key)) {
        groups.set(key, { stops: new Map(), order })
      }
      const group = groups.get(key)
      if (layer.type === 'line') {
        // Zoom-variant rules of the same colour merge into one ramp; the
        // first rule seen (the style's primary) wins any disagreement.
        for (const [zoom, width] of widthStopsOf(layer)) {
          if (!group.stops.has(zoom)) {
            group.stops.set(zoom, width)
          }
        }
      }
    }
  })
  return groups
}

/**
 * Turn groups into ordered passes. A pass paints one source-layer in one
 * mode; a symbol meeting a second colour (casing vs fill) opens the next
 * pass for that layer, keeping under/over order intact.
 */
function buildPasses(groups) {
  const passes = []
  const seenCount = new Map() // (source-layer|type|symbol) → passes already holding it

  for (const [key, group] of groups) {
    const [sourceLayer, type, symbol, colour] = JSON.parse(key)
    const seenKey = JSON.stringify([sourceLayer, type, symbol])
    const index = seenCount.get(seenKey) ?? 0
    seenCount.set(seenKey, index + 1)

    const candidates = passes.filter(
      (pass) => pass.sourceLayer === sourceLayer && pass.type === type
    )
    let pass = candidates[index]
    if (!pass) {
      pass = { sourceLayer, type, entries: new Map(), order: group.order }
      passes.push(pass)
    }
    pass.order = Math.min(pass.order, group.order)

    const widthStops = [...group.stops.entries()].sort((a, b) => a[0] - b[0])
    pass.entries.set(
      symbol,
      type === 'fill' ? colour : { stroke: colour, widthStops }
    )
  }

  passes.sort((a, b) => a.order - b.order)
  return passes
}

function passToLiteral(pass) {
  const noFilter = pass.entries.size === 1 && pass.entries.has(null)
  if (pass.type === 'fill') {
    if (noFilter) {
      return { layer: pass.sourceLayer, fill: pass.entries.get(null) }
    }
    return { layer: pass.sourceLayer, fills: Object.fromEntries(pass.entries) }
  }
  if (noFilter) {
    return { layer: pass.sourceLayer, line: pass.entries.get(null) }
  }
  return { layer: pass.sourceLayer, lines: Object.fromEntries(pass.entries) }
}

async function main() {
  const apiKey = process.env.OS_API_KEY
  if (!apiKey) {
    console.error('OS_API_KEY is required in the environment')
    process.exit(1)
  }

  const response = await fetch(`${STYLE_URL}?key=${encodeURIComponent(apiKey)}`)
  if (!response.ok) {
    console.error(
      `Style fetch failed: ${response.status} ${response.statusText}`
    )
    process.exit(1)
  }
  const style = await response.json()

  const passes = buildPasses(collectGroups(style.layers)).map(passToLiteral)
  const date = new Date().toISOString().slice(0, 10)

  // JSON, not a JS module: this is data with no logic in it, and as source it
  // drew a static-analysis finding for every number in a colour ramp. The
  // provenance that used to be a file header lives in the document itself, so
  // it survives the format — `src/services/report/pdf/ngd-light-style.js` is
  // the thin module that reads this and says what a pass means.
  const document = {
    $comment:
      'GENERATED FILE — do not edit by hand. Regenerate with: npm run extract:ngd-style. ' +
      'See tools/extract-ngd-style.js for what is kept and dropped, and ' +
      'ngd-light-style.js for what a pass means.',
    source: STYLE_URL,
    tileset: 'ngd-base',
    style: 'light-27700',
    fetched: date,
    ruleCount: style.layers.length,
    passes
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(document, null, 2) + '\n')
  console.log(
    `Wrote ${OUT_PATH}: ${passes.length} passes from ${style.layers.length} rules`
  )
}

await main()
