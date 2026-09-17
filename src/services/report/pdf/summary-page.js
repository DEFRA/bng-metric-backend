/**
 * Page 1: the site heading, the key figures, the site maps and the legend.
 *
 * Everything that draws into a map frame is synchronous. Tiles are fetched by
 * `prepareBasemap` before drawing starts, so nothing can interleave between a
 * marked-content sequence opening and closing — which is what keeps both the
 * visual layering and the tagged reading order intact.
 */

import {
  HABITAT_STYLES,
  drawBasemap,
  drawGeometry,
  drawGraticule,
  drawScaleBar,
  withFrameClip
} from './map.js'
import { envelopeOfAll } from './envelope.js'
import { effectiveDpi, gridIntervalMetres } from './grid.js'
import { projectorFor } from './projector.js'
import {
  BODY,
  BOLD,
  drawCredit,
  fillGround,
  fitCredit,
  labelAsArtifact,
  plural,
  prepareBasemap
} from './page-furniture.js'
import {
  BORDER,
  CONTENT_WIDTH,
  FONT_SIZE,
  HECTARE_DECIMALS,
  INK,
  MAP_PAD,
  MARGIN,
  MUTED,
  RULE_WIDTH,
  SCALE_BAR_BOTTOM_OFFSET,
  SCALE_BAR_INSET,
  SCALE_BAR_WIDTH_FRACTION,
  SITE_MAP_BOTTOM_GAP,
  SITE_MAP_GUTTER,
  SITE_MAP_HEIGHT,
  SITE_MAP_LABEL_HEIGHT,
  SITE_MAP_TOP_GAP,
  SQ_M_PER_HECTARE
} from './layout.js'
import { BASELINE, LAYER_NOUNS, POST_INTERVENTION } from './labels.js'
import { addKeyFiguresTable } from './key-figures.js'
import { buildAttribution, buildLegend } from './legend.js'

const INTRO_SPACING = 0.8
const SECTION_SPACING = 1

/**
 * Add the summary page.
 *
 * Kept to its four steps — heading, key figures, maps, legend — with each step
 * a named function, so the page reads as its own table of contents.
 */
async function addSummaryPage(context) {
  const { doc, root, basemap, attribution } = context
  const section = doc.struct('Sect', { title: 'Site report' })
  root.add(section)

  addHeading(doc, section, context.siteName)
  addCappedNote(doc, section, context.baseline, context.postIntervention)
  addKeyFiguresTable(doc, section, context.baseline, context.postIntervention)
  addSiteMapsHeading(doc, section)

  const panels = sitePanels(context.baseline, context.postIntervention)
  await addSiteMaps({ ...context, section, panels })

  section.add(buildLegend(doc, panels))
  if (basemap && attribution) {
    section.add(buildAttribution(doc, attribution))
  }
  section.end()
}

function addHeading(doc, section, siteName) {
  section.add(
    doc.struct('H1', () => {
      doc.font(BOLD).fontSize(FONT_SIZE.title).fillColor(INK)
      doc.text(`${siteName} `, MARGIN, MARGIN, { width: CONTENT_WIDTH })
    })
  )

  section.add(
    doc.struct('P', () => {
      doc.font(BODY).fontSize(FONT_SIZE.intro).fillColor(MUTED)
      doc.text(
        'Baseline and post-intervention habitat summary. All sizes are the ' +
          'recorded values held for this project. Geometry is shown on the ' +
          'British National Grid (EPSG:27700). ',
        { width: CONTENT_WIDTH }
      )
    })
  )
  doc.moveDown(INTRO_SPACING)
}

/**
 * Say so, first thing, when the report is showing only part of a layer.
 *
 * `report.maxFeaturesPerLayer` caps what the geometry read returns, so a very
 * large project is drawn and listed in part. Every page after this one would
 * then be internally consistent and quietly wrong — a site map missing a
 * third of its parcels looks exactly like a complete map of a smaller site,
 * and the key figures below count what was read rather than what exists.
 *
 * So the caveat goes above them both, in the reading order, as a tagged
 * paragraph rather than a footnote: a reader who acts on this document needs
 * to know it is a partial one before they read a number off it.
 */
function addCappedNote(doc, section, baseline, postIntervention) {
  const note = cappedNoteText(baseline, postIntervention)
  if (!note) {
    return
  }

  section.add(
    doc.struct('P', () => {
      doc.font(BOLD).fontSize(FONT_SIZE.intro).fillColor(INK)
      doc.text(note, { width: CONTENT_WIDTH })
    })
  )
  doc.moveDown(INTRO_SPACING)
}

/**
 * The wording, apart from the drawing, so it can be read as English in a test
 * — text drawn into a PDF is a compressed stream of glyph ids and cannot be
 * asserted on once it is in the file.
 *
 * Returns null when nothing was capped, which is the normal case.
 */
function cappedNoteText(baseline, postIntervention) {
  const sentences = [
    ...cappedSentences(baseline?.capped, BASELINE),
    ...cappedSentences(postIntervention?.capped, POST_INTERVENTION)
  ]
  if (sentences.length === 0) {
    return null
  }

  return (
    `${sentences.join(' ')} A layer this large is capped so the report stays ` +
    'a document that can be downloaded and opened; the service holds every ' +
    'feature and its own screens list them all. '
  )
}

function cappedSentences(capped, side) {
  return (capped ?? []).map(({ layer, shown, total }) => {
    const what = `${side.toLowerCase()} ${LAYER_NOUNS[layer] ?? layer}`
    return total
      ? `This report shows the first ${shown} of ${total} ${what}.`
      : `This report shows only the first ${shown} ${what}.`
  })
}

function addSiteMapsHeading(doc, section) {
  doc.moveDown(SECTION_SPACING)
  section.add(
    doc.struct('H2', () => {
      doc.font(BOLD).fontSize(FONT_SIZE.subHeading).fillColor(INK)
      doc.text('Site maps ', { width: CONTENT_WIDTH })
    })
  )
}

function sitePanels(baseline, postIntervention) {
  return [
    { label: BASELINE, site: baseline, style: HABITAT_STYLES.baseline },
    postIntervention && {
      label: POST_INTERVENTION,
      site: postIntervention,
      style: HABITAT_STYLES.postIntervention
    }
  ].filter(Boolean)
}

async function addSiteMaps(context) {
  const { doc, panels, baseline, postIntervention } = context
  const mapsTop = doc.y + SITE_MAP_TOP_GAP
  const mapWidth = (CONTENT_WIDTH - SITE_MAP_GUTTER) / 2

  // A single shared extent for both maps, so they are directly comparable —
  // the same ground at the same scale on both sides.
  const sharedEnvelope = envelopeOfAll(
    [baseline, postIntervention]
      .filter(Boolean)
      .map((site) => site.redLine?.geometry)
      .filter(Boolean)
  )

  for (const [index, panel] of panels.entries()) {
    await addSiteMapPanel({
      ...context,
      panel,
      sharedEnvelope,
      labelY: mapsTop,
      frame: {
        x: MARGIN + index * (mapWidth + SITE_MAP_GUTTER),
        y: mapsTop + SITE_MAP_LABEL_HEIGHT,
        width: mapWidth,
        height: SITE_MAP_HEIGHT
      }
    })
  }

  doc.y =
    mapsTop + SITE_MAP_LABEL_HEIGHT + SITE_MAP_HEIGHT + SITE_MAP_BOTTOM_GAP
}

/**
 * One panel: its caption, its tiles, its geometry, its Figure.
 *
 * The panels are drawn one after another rather than concurrently, and the
 * single `await` here is the tile fetch — it has to settle before any drawing
 * starts, for the reason the module header gives.
 */
async function addSiteMapPanel({
  doc,
  section,
  panel,
  frame,
  labelY,
  sharedEnvelope,
  grid,
  tileSource,
  basemap,
  attribution,
  attributionShort,
  graticule,
  stats
}) {
  labelAsArtifact(doc, () => {
    doc.font(BOLD).fontSize(FONT_SIZE.body).fillColor(INK)
    doc.text(`${panel.label} `, frame.x, labelY, { width: frame.width })
  })

  // No OS mapping goes into a frame that cannot carry its credit, so the
  // credit is measured first and its absence is what withholds the basemap.
  const credit = basemap
    ? fitCredit(doc, frame, [attribution, attributionShort])
    : null

  // All tile I/O happens before any drawing — see fetchTiles in map.js.
  const projector = projectorFor(sharedEnvelope, frame, { pad: MAP_PAD })
  const basemapLayer = credit
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
    credit,
    graticule,
    projector
  })
  recordMap(stats, drawn)

  section.add(
    doc.struct(
      'Figure',
      {
        alt: siteMapAltText(panel.label, panel.site, drawn),
        bbox: [frame.x, frame.y, frame.x + frame.width, frame.y + frame.height]
      },
      [drawn.content]
    )
  )
}

function recordMap(stats, drawn) {
  stats.maps += 1
  stats.tiles += drawn.tileCount
  if (drawn.z !== null) {
    stats.zooms.push(drawn.z)
  }
}

/**
 * Draw one site map: basemap, then habitat layers, then furniture.
 *
 * Synchronous by design — see the module header. Returns the marked structure
 * content so the caller can wrap it in a Figure.
 */
function drawSiteMap({
  doc,
  frame,
  site,
  style,
  grid,
  basemapLayer,
  credit,
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
  drawMapFurniture(doc, frame, projector, basemapLayer && credit)

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

/**
 * Frame edge, scale bar and basemap credit are decoration, not content.
 *
 * The credit is an artifact rather than a paragraph because it appears on
 * every map in the document; the reading order gets the same wording once,
 * from the tagged paragraph at the foot of this page.
 */
function drawMapFurniture(doc, frame, projector, credit) {
  labelAsArtifact(doc, () => {
    doc.save().lineWidth(RULE_WIDTH.frame).strokeColor(BORDER)
    doc.rect(frame.x, frame.y, frame.width, frame.height).stroke()
    doc.restore()
    drawScaleBar(doc, projector, {
      x: frame.x + SCALE_BAR_INSET,
      y: frame.y + frame.height - SCALE_BAR_BOTTOM_OFFSET,
      maxWidth: frame.width / SCALE_BAR_WIDTH_FRACTION
    })
    if (credit) {
      drawCredit(doc, frame, credit)
    }
  })
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
    `${label} site map. Red line boundary enclosing ${hectares.toFixed(HECTARE_DECIMALS)} hectares, ` +
    `containing ${plural(habitats, 'habitat parcel')}, ${plural(hedgerows, 'hedgerow')} ` +
    `and ${plural(watercourses, 'watercourse')}. ` +
    `The map covers approximately ${Math.round(width)} metres across. ` +
    'Each parcel is listed with its size and condition in the habitat table that follows. '
  )
}

export { addSummaryPage, cappedNoteText }
