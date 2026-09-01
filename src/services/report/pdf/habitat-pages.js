/**
 * Page 2 onwards: one row per habitat parcel — a thumbnail, then the recorded
 * attributes as real table cells.
 *
 * The pairing is the point. A map conveys nothing to a screen reader, so every
 * value a thumbnail shows is also given as text in the same row, and the
 * thumbnail's alt text describes only what the picture adds: shape and
 * position.
 */

import { HABITAT_STYLES } from './map.js'
import {
  BODY,
  BOLD,
  dataText,
  drawCredit,
  fitCredit,
  labelAsArtifact
} from './page-furniture.js'
import {
  A4_PORTRAIT_HEIGHT,
  BORDER,
  CELL_PADDING,
  CONTENT_WIDTH,
  FONT_SIZE,
  HABITAT_COLUMN_FRACTION,
  HABITAT_ROW_DIVIDER_OFFSET,
  HABITAT_ROW_HEIGHT,
  HABITAT_ROW_MAP_OFFSET,
  HABITAT_ROW_TEXT_OFFSET,
  HEADER_ROW_HEIGHT,
  HEADER_UNDERLINE_OFFSET,
  INK,
  MARGIN,
  MINI_MAP_COLUMN_PADDING,
  MINI_MAP_INSET,
  MINI_MAP_SIZE,
  MUTED,
  PARCEL_HECTARE_DECIMALS,
  RULE_WIDTH,
  SQ_M_PER_HECTARE
} from './layout.js'
import { drawMiniMap, prepareThumbnails } from './thumbnail.js'
import { BASELINE, POST_INTERVENTION } from './labels.js'

const TABLE_TOP_GAP = 10
const NOT_RECORDED = '—'

async function addHabitatPages({
  doc,
  root,
  baseline,
  postIntervention,
  grid,
  tileSource,
  withBasemap,
  attribution,
  attributionShort,
  stats
}) {
  const site = postIntervention ?? baseline
  const label = postIntervention ? POST_INTERVENTION : BASELINE
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
  addIntroduction(doc, section, label)

  const table = doc.struct('Table')
  section.add(table)

  // Every thumbnail frame is the same square, so one measurement settles the
  // credit for all of them — and, because no OS mapping is drawn into a frame
  // that cannot carry its credit, settles whether they get a basemap at all.
  const credit = withBasemap
    ? fitCredit(doc, thumbnailFrame(0), [attribution, attributionShort])
    : null

  // Prefetch every thumbnail's tiles before drawing starts. A mini-map frame
  // is always the same size, so its extent — and therefore its tile set — does
  // not depend on where the row lands on the page.
  const thumbnails = await prepareThumbnails({
    features,
    grid,
    tileSource,
    withBasemap: Boolean(credit),
    size: MINI_MAP_SIZE
  })

  addRows({
    doc,
    table,
    features,
    thumbnails,
    site,
    style,
    grid,
    credit,
    stats
  })

  table.end()
  section.end()
}

function addIntroduction(doc, section, label) {
  section.add(
    doc.struct('H2', () => {
      doc.font(BOLD).fontSize(FONT_SIZE.sectionHeading).fillColor(INK)
      doc.text(`${label} habitat parcels `, MARGIN, MARGIN, {
        width: CONTENT_WIDTH
      })
    })
  )
  section.add(
    doc.struct('P', () => {
      doc.font(BODY).fontSize(FONT_SIZE.bodySmall).fillColor(MUTED)
      doc.text(
        'Each row shows one parcel: its shape and position among the neighbouring parcels, ' +
          'and its recorded attributes. Every value shown on a mini-map is also given as text ' +
          'in the same row, so no information depends on seeing the picture. ',
        { width: CONTENT_WIDTH }
      )
    })
  )
}

function addRows({
  doc,
  table,
  features,
  thumbnails,
  site,
  style,
  grid,
  credit,
  stats
}) {
  const columns = habitatColumns()
  let y = doc.y + TABLE_TOP_GAP
  table.add(buildHeaderRow(doc, columns, y))
  y += HEADER_ROW_HEIGHT

  for (const feature of features) {
    if (y + HABITAT_ROW_HEIGHT > A4_PORTRAIT_HEIGHT - MARGIN) {
      doc.addPage()
      y = MARGIN
      table.add(buildHeaderRow(doc, columns, y))
      y += HEADER_ROW_HEIGHT
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
        credit,
        stats
      })
    )
    y += HABITAT_ROW_HEIGHT
    stats.habitats += 1
  }
}

function habitatColumns() {
  const mapWidth = MINI_MAP_SIZE + MINI_MAP_COLUMN_PADDING
  const remaining = CONTENT_WIDTH - mapWidth
  return [
    { key: 'map', label: 'Location', width: mapWidth },
    {
      key: 'ref',
      label: 'Ref',
      width: remaining * HABITAT_COLUMN_FRACTION.ref
    },
    {
      key: 'type',
      label: 'Habitat type',
      width: remaining * HABITAT_COLUMN_FRACTION.type
    },
    {
      key: 'condition',
      label: 'Condition',
      width: remaining * HABITAT_COLUMN_FRACTION.condition
    },
    {
      key: 'area',
      label: 'Size (ha)',
      width: remaining * HABITAT_COLUMN_FRACTION.area
    }
  ]
}

function buildHeaderRow(doc, columns, y) {
  const cells = columns.map((column, index) =>
    doc.struct('TH', { title: column.label, scope: 'Column' }, () => {
      doc.font(BOLD).fontSize(FONT_SIZE.tableCell).fillColor(INK)
      doc.text(`${column.label} `, columnX(columns, index), y, {
        width: column.width - CELL_PADDING
      })
    })
  )

  labelAsArtifact(doc, () => {
    doc.save().lineWidth(RULE_WIDTH.headerUnderline).strokeColor(INK)
    doc
      .moveTo(MARGIN, y + HEADER_UNDERLINE_OFFSET)
      .lineTo(MARGIN + CONTENT_WIDTH, y + HEADER_UNDERLINE_OFFSET)
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
  credit,
  stats
}) {
  const values = habitatRowValues(feature)
  const frame = thumbnailFrame(y)

  // Order matters, and getting it wrong is silent: the marked-content sequence
  // must be OPEN before anything is drawn into it. Drawing first and marking
  // afterwards yields a Figure wrapping an empty sequence, with every drawing
  // operation left as untagged, unartifacted content — PDF/UA 7.1-3. That is
  // exactly what the spike did until veraPDF caught it (512 occurrences, all
  // on the habitat pages; the site map, which marks first, was clean).
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

  // Outside the Figure's content sequence, as an artifact: the credit is not
  // part of what the picture shows, and fifty identical announcements would be
  // fifty interruptions. The tagged paragraph on page 1 carries the wording
  // into the reading order once.
  if (thumbnail.tiles) {
    labelAsArtifact(doc, () => drawCredit(doc, frame, credit))
  }

  const cells = [
    doc.struct('TD', [thumbnailFigure(doc, frame, values, figureContent)]),
    ...textCells(doc, columns, values, y)
  ]

  drawRowDivider(doc, y)
  return doc.struct('TR', cells)
}

/**
 * The alt text repeats no data — the sibling cells carry it — so it describes
 * only what the picture adds: shape and position.
 */
function thumbnailFigure(doc, frame, values, figureContent) {
  return doc.struct(
    'Figure',
    {
      alt:
        `Outline of parcel ${values.ref}, ${values.type}, ${values.area} hectares, ` +
        'shown in place among the neighbouring parcels. ',
      bbox: [frame.x, frame.y, frame.x + frame.width, frame.y + frame.height]
    },
    [figureContent]
  )
}

/** Every thumbnail is the same square, at the same inset from the margin. */
function thumbnailFrame(y) {
  return {
    x: MARGIN + MINI_MAP_INSET,
    y: y + HABITAT_ROW_MAP_OFFSET,
    width: MINI_MAP_SIZE,
    height: MINI_MAP_SIZE
  }
}

function textCells(doc, columns, values, y) {
  return ['ref', 'type', 'condition', 'area'].map((key, index) =>
    doc.struct('TD', () => {
      doc.font(BODY).fontSize(FONT_SIZE.tableCell).fillColor(INK)
      doc.text(
        `${values[key]} `,
        columnX(columns, index + 1),
        y + HABITAT_ROW_TEXT_OFFSET,
        { width: columns[index + 1].width - CELL_PADDING, ...dataText() }
      )
    })
  )
}

function drawRowDivider(doc, y) {
  labelAsArtifact(doc, () => {
    const dividerY = y + HABITAT_ROW_HEIGHT - HABITAT_ROW_DIVIDER_OFFSET
    doc.save().lineWidth(RULE_WIDTH.rowDivider).strokeColor(BORDER)
    doc
      .moveTo(MARGIN, dividerY)
      .lineTo(MARGIN + CONTENT_WIDTH, dividerY)
      .stroke()
    doc.restore()
  })
}

function habitatRowValues({ properties }) {
  const sqm = properties.sizeSquareMetres
  return {
    ref: properties.ref ?? NOT_RECORDED,
    type: properties.type ?? NOT_RECORDED,
    condition: properties.condition ?? NOT_RECORDED,
    area: Number.isFinite(sqm)
      ? (sqm / SQ_M_PER_HECTARE).toFixed(PARCEL_HECTARE_DECIMALS)
      : NOT_RECORDED
  }
}

function columnX(columns, index) {
  return (
    MARGIN +
    columns.slice(0, index).reduce((sum, column) => sum + column.width, 0)
  )
}

export { addHabitatPages }
