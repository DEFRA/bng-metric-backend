#!/usr/bin/env node
/**
 * What a site report costs at the per-layer ceiling (report.maxFeaturesPerLayer
 * in src/config.js), in bytes and seconds, by layout.
 *
 * Builds a synthetic project rather than reading one: `ceiling` habitat parcels
 * of ~900 vertices each — the density a real survey has (see
 * docs/site-report.md) — on a 16-column grid, with one individual tree at the
 * centre of each, and no basemap. Each case is drawn three times and the median
 * time reported.
 *
 * Usage:
 *   node scripts/bench-site-report.mjs [spaced|tiled] [ceiling] [both|baseline]
 *
 *   spaced  parcels a parcel's width apart (the default). A thumbnail draws
 *           only its own parcel, which is how the figures in
 *           docs/site-report.md were first measured.
 *   tiled   parcels sharing their edges, as a surveyed site's do. Each
 *           thumbnail also draws the eight neighbours around it, in full.
 *
 *   both      a baseline and a post-intervention side (the default): two site
 *             maps, and the post-intervention features listed.
 *   baseline  a baseline-only project: one site map.
 *
 * READ THE NUMBERS IN CONTEXT. Timings depend on the box; sizes do not.
 */

import { buildSiteReportPdf } from '../src/services/report/pdf/document.js'
import { toBuffer } from '../src/services/report/build-site-report.js'
import {
  baselineSite,
  postInterventionSite
} from '../src/services/report/site-model.test-fixtures.js'

const DEFAULT_CEILING = 250
const PARCEL_SIDE_METRES = 100
const VERTICES_PER_EDGE = 225
const GRID_COLUMNS = 16
const SITE_WEST = 412_000
const SITE_SOUTH = 287_000
const JITTER_METRES = 0.01
const RUNS = 3
const BYTES_PER_MB = 1e6
const MS_PER_SECOND = 1000
const LAYOUTS = ['table', 'cards']
const PITCH = { spaced: 2, tiled: 1 }
const SIDES = ['both', 'baseline']

const arrangement = process.argv[2] ?? 'spaced'
const ceiling = Number(process.argv[3] ?? DEFAULT_CEILING)
const sides = process.argv[4] ?? 'both'
if (
  !(arrangement in PITCH) ||
  !Number.isSafeInteger(ceiling) ||
  !SIDES.includes(sides)
) {
  console.error(
    'Usage: bench-site-report.mjs [spaced|tiled] [ceiling] [both|baseline]'
  )
  process.exit(1)
}
const pitch = PARCEL_SIDE_METRES * PITCH[arrangement]

/** A square ring of 4 × VERTICES_PER_EDGE vertices, slightly irregular. */
function ring(west, south) {
  const side = PARCEL_SIDE_METRES
  const corners = [
    [west, south],
    [west + side, south],
    [west + side, south + side],
    [west, south + side],
    [west, south]
  ]
  const points = []
  for (let corner = 0; corner < corners.length - 1; corner++) {
    const [ax, ay] = corners[corner]
    const [bx, by] = corners[corner + 1]
    for (let i = 0; i < VERTICES_PER_EDGE; i++) {
      const t = i / VERTICES_PER_EDGE
      points.push([
        ax + (bx - ax) * t + Math.sin(i) * JITTER_METRES,
        ay + (by - ay) * t + Math.cos(i) * JITTER_METRES
      ])
    }
  }
  points.push(points[0])
  return points
}

function site(withTrees, side) {
  const fixture = side === 'baseline' ? baselineSite() : postInterventionSite()
  const parcel = fixture.layers.habitats[0].properties
  const tree = fixture.layers.trees[0].properties
  const habitats = []
  const trees = []
  for (let i = 0; i < ceiling; i++) {
    const west = SITE_WEST + (i % GRID_COLUMNS) * pitch
    const south = SITE_SOUTH + Math.floor(i / GRID_COLUMNS) * pitch
    const centre = PARCEL_SIDE_METRES / 2
    habitats.push({
      properties: { ...parcel, ref: `H${i}` },
      geometry: { type: 'MultiPolygon', coordinates: [[ring(west, south)]] }
    })
    trees.push({
      properties: { ...tree, ref: `T${i}` },
      geometry: {
        type: 'MultiPoint',
        coordinates: [[west + centre, south + centre]]
      }
    })
  }

  const east = SITE_WEST + GRID_COLUMNS * pitch
  const north = SITE_SOUTH + Math.ceil(ceiling / GRID_COLUMNS) * pitch
  fixture.redLine = {
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [SITE_WEST, SITE_SOUTH],
            [east, SITE_SOUTH],
            [east, north],
            [SITE_WEST, north],
            [SITE_WEST, SITE_SOUTH]
          ]
        ]
      ]
    }
  }
  fixture.layers.habitats = habitats
  fixture.layers.trees = withTrees ? trees : []
  fixture.documentCounts = {
    ...fixture.documentCounts,
    habitats: habitats.length,
    trees: fixture.layers.trees.length
  }
  return fixture
}

async function measure(layout, withTrees) {
  const timings = []
  let bytes = 0
  for (let run = 0; run < RUNS; run++) {
    const started = performance.now()
    const { doc } = await buildSiteReportPdf({
      baseline: site(withTrees, 'baseline'),
      postIntervention:
        sides === 'both' ? site(withTrees, 'postIntervention') : null,
      layout
    })
    bytes = (await toBuffer(doc)).length
    timings.push(performance.now() - started)
  }
  timings.sort((a, b) => a - b)
  return {
    megabytes: (bytes / BYTES_PER_MB).toFixed(1),
    seconds: (timings[Math.floor(RUNS / 2)] / MS_PER_SECOND).toFixed(2)
  }
}

console.log(
  `${arrangement} parcels, ${ceiling} per layer, ${sides === 'both' ? 'both sides' : 'baseline only'}, no basemap`
)
for (const layout of LAYOUTS) {
  for (const withTrees of [false, true]) {
    const { megabytes, seconds } = await measure(layout, withTrees)
    const what = withTrees
      ? `${ceiling} parcels and ${ceiling} trees`
      : `${ceiling} parcels`
    console.log(`  ${layout}, ${what}: ${megabytes} MB, ${seconds} s`)
  }
}
