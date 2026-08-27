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
  fillGround,
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
import { BASELINE, POST_INTERVENTION } from './labels.js'
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

async function addSiteMaps({
  doc,
  section,
  panels,
  baseline,
  postIntervention,
  grid,
  tileSource,
  basemap,
  graticule,
  stats
}) {
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
    const frame = {
      x: MARGIN + index * (mapWidth + SITE_MAP_GUTTER),
      y: mapsTop + SITE_MAP_LABEL_HEIGHT,
      width: mapWidth,
      height: SITE_MAP_HEIGHT
    }

    labelAsArtifact(doc, () => {
      doc.font(BOLD).fontSize(FONT_SIZE.body).fillColor(INK)
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
    recordMap(stats, drawn)

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

  doc.y =
    mapsTop + SITE_MAP_LABEL_HEIGHT + SITE_MAP_HEIGHT + SITE_MAP_BOTTOM_GAP
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
  drawMapFurniture(doc, frame, projector)

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

/** Frame edge and scale bar are decoration, not content. */
function drawMapFurniture(doc, frame, projector) {
  labelAsArtifact(doc, () => {
    doc.save().lineWidth(RULE_WIDTH.frame).strokeColor(BORDER)
    doc.rect(frame.x, frame.y, frame.width, frame.height).stroke()
    doc.restore()
    drawScaleBar(doc, projector, {
      x: frame.x + SCALE_BAR_INSET,
      y: frame.y + frame.height - SCALE_BAR_BOTTOM_OFFSET,
      maxWidth: frame.width / SCALE_BAR_WIDTH_FRACTION
    })
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

export { addSummaryPage }
