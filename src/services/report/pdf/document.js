/**
 * The PDF itself: a tagged, PDF/UA-targeted site report.
 *
 * Structure of the output:
 *   Page 1  site heading, key figures (pdfkit's built-in tagged table),
 *           baseline and post-intervention site maps side by side, legend
 *   Page 2+ one row per habitat parcel: mini-map, ref, type, condition, size
 *
 * Every map is a `Figure` with a bbox and alt text, and every map is followed
 * by the same information as real table rows — a map conveys nothing to a
 * screen reader, so the table is what actually carries the content.
 *
 * Numbers come from the project document, never from the geometry. The
 * document's `sizeSquareMetres` / `sizeMetres` are what the service shows on
 * screen and what the unit calculation ran on; recomputing them here would give
 * the report a second opinion, and a report that disagrees with the page it was
 * generated from is worse than no report at all.
 */

import path from 'node:path'

import PDFDocument from 'pdfkit'

import {
  HABITAT_STYLES,
  drawBasemap,
  drawGeometry,
  drawGraticule,
  drawScaleBar,
  fetchTiles,
  withFrameClip
} from './map.js'
import { envelopeOf, envelopeOfAll, padEnvelope } from './envelope.js'
import { effectiveDpi, gridIntervalMetres, pickZoom } from './grid.js'
import { fitEnvelopeToFrame, makeProjector, projectorFor } from './projector.js'

const A4_PORTRAIT = [595.28, 841.89]
const MARGIN = 40
const CONTENT_WIDTH = A4_PORTRAIT[0] - MARGIN * 2

// GOV.UK palette (govuk-frontend colour names).
const INK = '#0b0c0c'
const MUTED = '#505a5f'
const BORDER = '#b1b4b6'
const MAP_GROUND = '#f3f2f1'

const SITE_MAP_HEIGHT = 210
const MINI_MAP_SIZE = 52
const HABITAT_ROW_HEIGHT = 62
const MAP_PAD = 0.08
const MINI_MAP_PAD = 0.35
const SQ_M_PER_HECTARE = 10_000

// Target print density for the parcel thumbnails. Lower than the site map's
// because a thumbnail is 18 mm square: on the largest example site the
// thumbnail basemaps are what take the document from under 1 MB to several, and
// halving this is invisible at that size. Tune here before dropping the
// basemap entirely.
const THUMBNAIL_TARGET_DPI = 150

const CONTEXT_FILL = '#d8d4d0'
const CONTEXT_STROKE = '#b1b4b6'

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
 * Build the report.
 *
 * @param {object} options
 * @param {object} options.baseline               site model from site-data.js
 * @param {object|null} [options.postIntervention]
 * @param {object|null} [options.grid]            tile matrix set; null with no basemap
 * @param {Function|null} [options.tileSource]    null means no basemap
 * @param {string} [options.attribution]          burned into the page; see below
 * @param {boolean} [options.graticule]           registration overlay, for diagnosis
 * @param {boolean} [options.habitatBasemap]      basemap behind each thumbnail
 * @returns {Promise<{ doc: PDFDocument, stats: object }>}
 */
async function buildSiteReportPdf({
  baseline,
  postIntervention = null,
  grid = null,
  tileSource = null,
  attribution = null,
  graticule = false,
  habitatBasemap = true
}) {
  const siteName = baseline.siteName ?? 'BNG site'
  const title = `Biodiversity net gain site report — ${siteName}`
  const basemap = Boolean(grid && tileSource)

  const doc = new PDFDocument({
    size: A4_PORTRAIT,
    margin: MARGIN,
    // PDF/UA checklist, from pdfkit's accessibility docs.
    pdfVersion: '1.5',
    subset: 'PDF/UA',
    tagged: true,
    displayTitle: true,
    lang: 'en-GB',
    info: {
      Title: title,
      Author: 'Defra — Biodiversity Net Gain service',
      Subject: 'Site report with baseline and post-intervention habitat mapping'
    }
  })

  registerFonts(doc)

  const stats = { maps: 0, tiles: 0, habitats: 0, zooms: [] }
  const root = doc.struct('Document', { title })
  doc.addStructure(root)

  const context = {
    doc,
    root,
    baseline,
    postIntervention,
    grid,
    tileSource,
    basemap,
    attribution,
    stats
  }

  await addSummaryPage({ ...context, graticule, siteName })
  await addHabitatPages({ ...context, withBasemap: basemap && habitatBasemap })

  root.end()
  return { doc, stats }
}

/* ------------------------------------------------------------------ page 1 */

async function addSummaryPage({
  doc,
  root,
  baseline,
  postIntervention,
  grid,
  tileSource,
  basemap,
  attribution,
  graticule,
  stats,
  siteName
}) {
  const section = doc.struct('Sect', { title: 'Site report' })
  root.add(section)

  section.add(
    doc.struct('H1', () => {
      doc.font(BOLD).fontSize(22).fillColor(INK)
      doc.text(`${siteName} `, MARGIN, MARGIN, { width: CONTENT_WIDTH })
    })
  )

  section.add(
    doc.struct('P', () => {
      doc.font(BODY).fontSize(10).fillColor(MUTED)
      doc.text(
        'Baseline and post-intervention habitat summary. All sizes are the ' +
          'recorded values held for this project. Geometry is shown on the ' +
          'British National Grid (EPSG:27700). ',
        { width: CONTENT_WIDTH }
      )
    })
  )

  doc.moveDown(0.8)
  addKeyFiguresTable(doc, section, baseline, postIntervention)

  doc.moveDown(1)
  section.add(
    doc.struct('H2', () => {
      doc.font(BOLD).fontSize(14).fillColor(INK)
      doc.text('Site maps ', { width: CONTENT_WIDTH })
    })
  )

  const mapsTop = doc.y + 6
  const gutter = 16
  const mapWidth = (CONTENT_WIDTH - gutter) / 2

  // A single shared extent for both maps, so they are directly comparable —
  // the same ground at the same scale on both sides.
  const sharedEnvelope = envelopeOfAll(
    [baseline, postIntervention]
      .filter(Boolean)
      .map((site) => site.redLine?.geometry)
      .filter(Boolean)
  )

  const panels = [
    { label: 'Baseline', site: baseline, style: HABITAT_STYLES.baseline },
    postIntervention && {
      label: 'Post-intervention',
      site: postIntervention,
      style: HABITAT_STYLES.postIntervention
    }
  ].filter(Boolean)

  for (const [index, panel] of panels.entries()) {
    const frame = {
      x: MARGIN + index * (mapWidth + gutter),
      y: mapsTop + 14,
      width: mapWidth,
      height: SITE_MAP_HEIGHT
    }

    labelAsArtifact(doc, () => {
      doc.font(BOLD).fontSize(9.5).fillColor(INK)
      doc.text(`${panel.label} `, frame.x, mapsTop, { width: frame.width })
    })

    // All tile I/O happens before any drawing — see fetchTiles in map.js.
    const projector = projectorFor(sharedEnvelope, frame, { pad: MAP_PAD })
    const basemapLayer = basemap
      ? await prepareBasemap({
          grid,
          extent: projector.extent,
          tileSource,
          frameWidth: frame.width
        })
      : null

    const drawn = drawSiteMap({
      doc,
      frame,
      site: panel.site,
      style: panel.style,
      grid,
      basemapLayer,
      graticule,
      projector
    })
    stats.maps += 1
    stats.tiles += drawn.tileCount
    if (drawn.z !== null) {
      stats.zooms.push(drawn.z)
    }

    section.add(
      doc.struct(
        'Figure',
        {
          alt: siteMapAltText(panel.label, panel.site, drawn),
          bbox: [
            frame.x,
            frame.y,
            frame.x + frame.width,
            frame.y + frame.height
          ]
        },
        [drawn.content]
      )
    )
  }

  doc.y = mapsTop + 14 + SITE_MAP_HEIGHT + 26
  section.add(buildLegend(doc, panels))
  if (basemap && attribution) {
    section.add(buildAttribution(doc, attribution))
  }
  section.end()
}

/**
 * Choose a zoom and fetch every tile the frame needs, before any drawing.
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

/**
 * Draw one site map: basemap, then habitat layers, then furniture.
 *
 * Synchronous by design. Tiles are already in hand, so nothing can interleave
 * between the marked-content start and its end — which keeps both the visual
 * layering and the tagged reading order intact.
 *
 * Returns the marked structure content so the caller can wrap it in a Figure.
 */
function drawSiteMap({
  doc,
  frame,
  site,
  style,
  grid,
  basemapLayer,
  graticule,
  projector
}) {
  const content = doc.markStructureContent('Figure')

  let tileCount = 0
  withFrameClip(doc, frame, () => {
    if (basemapLayer) {
      tileCount = drawBasemap(doc, {
        grid,
        z: basemapLayer.z,
        projector,
        tiles: basemapLayer.tiles
      }).tileCount
    } else {
      fillGround(doc, frame)
    }

    drawSiteLayers(doc, site, projector, style)

    if (graticule && basemapLayer) {
      // Derived from the grid and zoom, not read off a tile — a real OS tile
      // carries no such metadata, and an overlay that reads it there silently
      // stops drawing rather than failing.
      drawGraticule(
        doc,
        projector,
        gridIntervalMetres(grid.resolutions[basemapLayer.z], grid.tileSize)
      )
    }
  })

  doc.endMarkedContent()

  // Frame edge and scale bar are decoration, not content.
  labelAsArtifact(doc, () => {
    doc.save().lineWidth(0.6).strokeColor(BORDER)
    doc.rect(frame.x, frame.y, frame.width, frame.height).stroke()
    doc.restore()
    drawScaleBar(doc, projector, {
      x: frame.x + 6,
      y: frame.y + frame.height - 14,
      maxWidth: frame.width / 3
    })
  })

  const z = basemapLayer?.z ?? null
  return {
    content,
    tileCount,
    z,
    dpi:
      z === null ? null : effectiveDpi(grid, z, projector.extent, frame.width),
    projector
  }
}

function drawSiteLayers(doc, site, projector, style) {
  for (const habitat of site.layers.habitats ?? []) {
    drawGeometry(doc, habitat.geometry, projector, style)
  }
  for (const hedgerow of site.layers.hedgerows ?? []) {
    drawGeometry(doc, hedgerow.geometry, projector, HABITAT_STYLES.hedgerow)
  }
  for (const watercourse of site.layers.watercourses ?? []) {
    drawGeometry(
      doc,
      watercourse.geometry,
      projector,
      HABITAT_STYLES.watercourse
    )
  }
  for (const tree of site.layers.trees ?? []) {
    drawGeometry(doc, tree.geometry, projector, HABITAT_STYLES.tree)
  }
  if (site.redLine) {
    drawGeometry(doc, site.redLine.geometry, projector, HABITAT_STYLES.redLine)
  }
}

function fillGround(doc, frame) {
  doc.save()
  doc.rect(frame.x, frame.y, frame.width, frame.height).fillColor(MAP_GROUND)
  doc.fill()
  doc.restore()
}

function siteMapAltText(label, site, drawn) {
  const habitats = site.layers.habitats?.length ?? 0
  const hedgerows = site.layers.hedgerows?.length ?? 0
  const watercourses = site.layers.watercourses?.length ?? 0
  const hectares = (site.redLineAreaSqm ?? 0) / SQ_M_PER_HECTARE
  const width = drawn.projector.extent.maxX - drawn.projector.extent.minX

  // Alt text says what the map shows, not that a map exists. The parcel-level
  // detail is in the table that follows, which is where a screen-reader user
  // gets the actual data.
  return (
    `${label} site map. Red line boundary enclosing ${hectares.toFixed(2)} hectares, ` +
    `containing ${plural(habitats, 'habitat parcel')}, ${plural(hedgerows, 'hedgerow')} ` +
    `and ${plural(watercourses, 'watercourse')}. ` +
    `The map covers approximately ${Math.round(width)} metres across. ` +
    'Each parcel is listed with its size and condition in the habitat table that follows. '
  )
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

/* --------------------------------------------------------- key figures */

const LAYER_LABELS = {
  habitats: 'Area habitats',
  hedgerows: 'Hedgerows',
  watercourses: 'Watercourses',
  trees: 'Individual trees'
}

function addKeyFiguresTable(doc, section, baseline, postIntervention) {
  const rows = [
    ['Measure', 'Baseline', 'Post-intervention'],
    ...Object.keys(LAYER_LABELS).map((role) => [
      LAYER_LABELS[role],
      describeLayer(baseline, role),
      postIntervention ? describeLayer(postIntervention, role) : 'Not supplied'
    ]),
    [
      'Biodiversity units',
      describeUnits(baseline),
      postIntervention ? describeUnits(postIntervention) : 'Not supplied'
    ]
  ]

  // pdfkit's built-in table generation (added in 0.17.0).
  //
  // `structParent` is what makes it accessible, and it is easy to get wrong:
  // pdfkit's table builds its OWN Table/TR/TH/TD structure and attaches it to
  // the element given here. Wrapping the call in `doc.struct('Table', () => …)`
  // instead looks right and renders identically, but emits a Table element
  // containing no rows at all — the cells become one undifferentiated marked
  // content sequence. Verified by counting /S /TD in the output.
  doc.font(BODY).fontSize(9.5).fillColor(INK)
  doc.table({
    structParent: section,
    columnStyles: ['*', 110, 110],
    rowStyles: (index) =>
      index === 0
        ? { border: [0, 0, 1.5, 0], borderColor: INK, font: BOLD }
        : { border: [0, 0, 0.5, 0], borderColor: BORDER },
    // `type` and `scope` are pdfkit's accessibility hooks for tables. Scope is
    // undocumented but supported ('Row' | 'Column' | 'Both'), and setting it
    // also makes pdfkit emit a /Headers array linking each data cell to the
    // headers that describe it — which is what a screen reader announces.
    data: rows.map((row, rowIndex) =>
      row.map((cell, columnIndex) => ({
        text: `${cell} `,
        ...headerRole(rowIndex, columnIndex)
      }))
    )
  })
}

/** Column headers scope down their column; the stub column scopes its row. */
function headerRole(rowIndex, columnIndex) {
  if (rowIndex === 0) {
    return { type: 'TH', scope: 'Column' }
  }
  if (columnIndex === 0) {
    return { type: 'TH', scope: 'Row' }
  }
  return { type: 'TD' }
}

function describeLayer(site, role) {
  const features = site.layers[role] ?? []
  if (features.length === 0) {
    return 'None'
  }
  if (role === 'habitats') {
    const sqm = sumBy(
      features,
      (feature) => feature.properties.sizeSquareMetres
    )
    return `${features.length} parcels, ${(sqm / SQ_M_PER_HECTARE).toFixed(2)} ha`
  }
  if (role === 'trees') {
    return plural(features.length, 'tree')
  }
  const metres = sumBy(features, (feature) => feature.properties.sizeMetres)
  return `${plural(features.length, 'feature')} (${Math.round(metres)} m)`
}

function sumBy(features, read) {
  return features.reduce((total, feature) => total + (read(feature) ?? 0), 0)
}

/**
 * The headline number, taken verbatim from the units the service calculated.
 * Area habitats and individual trees are both "area" units and are summed the
 * same way the summary screen sums them.
 */
function describeUnits(site) {
  const units = site.units
  const total = [
    units?.habitatsTotal,
    units?.treesTotal,
    units?.hedgerowsTotal,
    units?.watercoursesTotal
  ].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
  return `${total.toFixed(2)} units`
}

/* ------------------------------------------------------------- legend */

function buildLegend(doc, panels) {
  const entries = [
    ['Red line boundary', HABITAT_STYLES.redLine.stroke],
    ...panels.map((panel) => [`${panel.label} parcel`, panel.style.fill]),
    ['Hedgerow', HABITAT_STYLES.hedgerow.stroke],
    ['Watercourse', HABITAT_STYLES.watercourse.stroke]
  ]

  // Share the content width evenly so labels never collide, whatever the
  // number of entries (a post-intervention file adds one).
  const columnWidth = CONTENT_WIDTH / entries.length
  const swatch = 8
  const top = doc.y

  labelAsArtifact(doc, () => {
    entries.forEach(([, colour], index) => {
      doc.save()
      doc
        .rect(MARGIN + index * columnWidth, top + 1, swatch, swatch)
        .fillColor(colour)
        .fillOpacity(0.75)
        .fill()
      doc.restore()
    })
  })

  // The legend's meaning is carried by text, not only by the swatch colours —
  // colour alone must never be the sole carrier of information.
  return doc.struct('P', () => {
    doc.font(BODY).fontSize(7.5).fillColor(MUTED)
    entries.forEach(([label], index) => {
      doc.text(
        `${label} `,
        MARGIN + swatch + 4 + index * columnWidth,
        top + 1,
        { width: columnWidth - swatch - 8, lineGap: -1 }
      )
    })
    doc.y = top + 20
  })
}

/**
 * Basemap attribution, burned into the page.
 *
 * A PDF cannot carry a dynamic credit control the way a browser map can, so
 * the credit has to be part of the document. The wording arrives by
 * configuration because it is OS's to dictate and has not yet been confirmed
 * with them — see the licensing questions on BMD-984.
 */
function buildAttribution(doc, attribution) {
  const top = doc.y
  return doc.struct('P', () => {
    doc.font(BODY).fontSize(7).fillColor(MUTED)
    doc.text(`${attribution} `, MARGIN, top, { width: CONTENT_WIDTH })
  })
}

/* ------------------------------------------------------- habitat pages */

async function addHabitatPages({
  doc,
  root,
  baseline,
  postIntervention,
  grid,
  tileSource,
  withBasemap,
  stats
}) {
  const site = postIntervention ?? baseline
  const label = postIntervention ? 'Post-intervention' : 'Baseline'
  const style = postIntervention
    ? HABITAT_STYLES.postIntervention
    : HABITAT_STYLES.baseline
  const features = site.layers.habitats ?? []
  if (features.length === 0) {
    return
  }

  const section = doc.struct('Sect', { title: 'Habitat parcels' })
  root.add(section)

  doc.addPage()
  section.add(
    doc.struct('H2', () => {
      doc.font(BOLD).fontSize(15).fillColor(INK)
      doc.text(`${label} habitat parcels `, MARGIN, MARGIN, {
        width: CONTENT_WIDTH
      })
    })
  )
  section.add(
    doc.struct('P', () => {
      doc.font(BODY).fontSize(9).fillColor(MUTED)
      doc.text(
        'Each row shows one parcel: its shape and position among the neighbouring parcels, ' +
          'and its recorded attributes. Every value shown on a mini-map is also given as text ' +
          'in the same row, so no information depends on seeing the picture. ',
        { width: CONTENT_WIDTH }
      )
    })
  )

  const table = doc.struct('Table')
  section.add(table)

  // Prefetch every thumbnail's tiles before drawing starts. A mini-map frame
  // is always the same size, so its extent — and therefore its tile set — does
  // not depend on where the row lands on the page.
  const thumbnails = await prepareThumbnails({
    features,
    grid,
    tileSource,
    withBasemap
  })

  const columns = habitatColumns()
  let y = doc.y + 10
  table.add(buildHeaderRow(doc, columns, y))
  y += 20

  for (const feature of features) {
    if (y + HABITAT_ROW_HEIGHT > A4_PORTRAIT[1] - MARGIN) {
      doc.addPage()
      y = MARGIN
      table.add(buildHeaderRow(doc, columns, y))
      y += 20
    }

    table.add(
      buildHabitatRow({
        doc,
        feature,
        columns,
        y,
        style,
        site,
        grid,
        thumbnail: thumbnails.get(feature),
        stats
      })
    )
    y += HABITAT_ROW_HEIGHT
    stats.habitats += 1
  }

  table.end()
  section.end()
}

/**
 * Work out each thumbnail's extent and fetch its tiles, before any drawing.
 */
async function prepareThumbnails({ features, grid, tileSource, withBasemap }) {
  const square = { x: 0, y: 0, width: MINI_MAP_SIZE, height: MINI_MAP_SIZE }
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

function habitatColumns() {
  const mapWidth = MINI_MAP_SIZE + 10
  const remaining = CONTENT_WIDTH - mapWidth
  return [
    { key: 'map', label: 'Location', width: mapWidth },
    { key: 'ref', label: 'Ref', width: remaining * 0.12 },
    { key: 'type', label: 'Habitat type', width: remaining * 0.4 },
    { key: 'condition', label: 'Condition', width: remaining * 0.26 },
    { key: 'area', label: 'Size (ha)', width: remaining * 0.22 }
  ]
}

function buildHeaderRow(doc, columns, y) {
  const cells = columns.map((column, index) =>
    doc.struct('TH', { title: column.label, scope: 'Column' }, () => {
      doc.font(BOLD).fontSize(8.5).fillColor(INK)
      doc.text(`${column.label} `, columnX(columns, index), y, {
        width: column.width - 6
      })
    })
  )

  labelAsArtifact(doc, () => {
    doc.save().lineWidth(1).strokeColor(INK)
    doc
      .moveTo(MARGIN, y + 14)
      .lineTo(MARGIN + CONTENT_WIDTH, y + 14)
      .stroke()
    doc.restore()
  })

  return doc.struct('TR', cells)
}

function buildHabitatRow({
  doc,
  feature,
  columns,
  y,
  style,
  site,
  grid,
  thumbnail,
  stats
}) {
  const values = habitatRowValues(feature)

  const frame = {
    x: MARGIN + 2,
    y: y + 3,
    width: MINI_MAP_SIZE,
    height: MINI_MAP_SIZE
  }

  // Order matters, and getting it wrong is silent: the marked-content sequence
  // must be OPEN before anything is drawn into it. Drawing first and marking
  // afterwards yields a Figure wrapping an empty sequence, with every drawing
  // operation left as untagged, unartifacted content — PDF/UA 7.1-3. That is
  // exactly what the spike did until veraPDF caught it (512 occurrences, all
  // on the habitat pages; the site map, which marks first, was clean).
  // `drawSiteMap` is the pattern to copy.
  const figureContent = doc.markStructureContent('Figure')
  stats.tiles += drawMiniMap({
    doc,
    frame,
    feature,
    style,
    site,
    grid,
    thumbnail
  }).tileCount
  doc.endMarkedContent()

  const cells = [
    doc.struct('TD', [
      // The alt text repeats no data — the sibling cells carry it — so it
      // describes only what the picture adds: shape and position.
      doc.struct(
        'Figure',
        {
          alt:
            `Outline of parcel ${values.ref}, ${values.type}, ${values.area} hectares, ` +
            'shown in place among the neighbouring parcels. ',
          bbox: [
            frame.x,
            frame.y,
            frame.x + frame.width,
            frame.y + frame.height
          ]
        },
        [figureContent]
      )
    ]),
    ...['ref', 'type', 'condition', 'area'].map((key, index) =>
      doc.struct('TD', () => {
        doc.font(BODY).fontSize(8.5).fillColor(INK)
        doc.text(`${values[key]} `, columnX(columns, index + 1), y + 6, {
          width: columns[index + 1].width - 6
        })
      })
    )
  ]

  labelAsArtifact(doc, () => {
    doc.save().lineWidth(0.4).strokeColor(BORDER)
    doc
      .moveTo(MARGIN, y + HABITAT_ROW_HEIGHT - 4)
      .lineTo(MARGIN + CONTENT_WIDTH, y + HABITAT_ROW_HEIGHT - 4)
      .stroke()
    doc.restore()
  })

  return doc.struct('TR', cells)
}

const NOT_RECORDED = '—'

function habitatRowValues({ properties }) {
  const sqm = properties.sizeSquareMetres
  return {
    ref: properties.ref ?? NOT_RECORDED,
    type: properties.type ?? NOT_RECORDED,
    condition: properties.condition ?? NOT_RECORDED,
    area: Number.isFinite(sqm)
      ? (sqm / SQ_M_PER_HECTARE).toFixed(3)
      : NOT_RECORDED
  }
}

/**
 * A parcel thumbnail, zoomed to the parcel itself so its shape is legible.
 *
 * Neighbouring parcels and the site boundary are drawn faintly underneath for
 * orientation — without them a lone polygon on a blank square tells you the
 * shape but not where it sits.
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

    // Context first, so the subject parcel draws over it.
    for (const other of site.layers.habitats ?? []) {
      if (other !== feature) {
        drawGeometry(doc, other.geometry, projector, {
          fill: CONTEXT_FILL,
          stroke: CONTEXT_STROKE,
          fillOpacity: 0.45,
          lineWidth: 0.3
        })
      }
    }
    if (site.redLine) {
      drawGeometry(doc, site.redLine.geometry, projector, {
        stroke: HABITAT_STYLES.redLine.stroke,
        lineWidth: 0.8
      })
    }
    drawGeometry(doc, feature.geometry, projector, { ...style, lineWidth: 0.8 })
  })

  doc.save().lineWidth(0.5).strokeColor(BORDER)
  doc.rect(frame.x, frame.y, frame.width, frame.height).stroke()
  doc.restore()

  return { tileCount, projector }
}

function columnX(columns, index) {
  return (
    MARGIN +
    columns.slice(0, index).reduce((sum, column) => sum + column.width, 0)
  )
}

/* ----------------------------------------------------------- utilities */

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

export { buildSiteReportPdf, plural }
