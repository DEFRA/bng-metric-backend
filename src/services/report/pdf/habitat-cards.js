/**
 * Page 2 onwards, card layout: one card per habitat parcel.
 *
 * The alternative to `habitat-pages.js`, selected with `?layout=cards`. Same
 * data, same mini-map, different shape — and the difference is not cosmetic.
 *
 * A table has to fit every attribute into a column, so the number of attributes
 * it can carry is bounded by the width of the page. Five columns already leaves
 * "Modified grassland" wrapping in a 90-point cell. A card turns that ninety
 * degrees: each attribute gets a line of its own, so the report can show what
 * the project actually holds — broad habitat, distinctiveness, strategic
 * significance, retention category and calculated units — instead of the four
 * that happened to fit.
 *
 * Two consequences worth knowing:
 *
 *   1. **It sidesteps the `/Headers` problem.** The table layout is hand-laid,
 *      because a `doc.table()` cell cannot hold a drawing, and pdfkit only
 *      emits `/Headers` inside `doc.table()`. So its cells carry `/Scope` and
 *      nothing links a value back to the header describing it. A card has no
 *      columns to associate, so the question does not arise: each line is a
 *      paragraph reading "Condition: Poor", which needs no table navigation at
 *      all.
 *   2. **Cards are taller than rows**, so a card layout is longer. That is the
 *      trade for the extra attributes, and it is why this is a choice rather
 *      than a replacement.
 *
 * Cards are sized from their content. A project that has not been calculated
 * has no units or distinctiveness to show, and those lines are omitted rather
 * than printed as blanks — an empty row invites the reader to wonder what is
 * missing, whereas a shorter card simply says less.
 */

import { HABITAT_STYLES } from './map.js'
import { drawMiniMap, prepareThumbnails } from './thumbnail.js'
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
  CARD_GAP,
  CARD_GUTTER,
  CARD_HEADING_HEIGHT,
  CARD_LABEL_WIDTH,
  CARD_LINE_HEIGHT,
  CARD_MAP_SIZE,
  CARD_PADDING,
  CARD_TOP_GAP,
  CONTENT_WIDTH,
  FONT_SIZE,
  INK,
  MARGIN,
  MUTED,
  PARCEL_HECTARE_DECIMALS,
  RULE_WIDTH,
  SQ_M_PER_HECTARE
} from './layout.js'
import { BASELINE, POST_INTERVENTION } from './labels.js'

const UNIT_DECIMALS = 2

/** Clear space between the end of the longest label and the value column. */
const CARD_LABEL_GAP = 8

/** Per-document, because the width depends on the fonts registered on it. */
const LABEL_WIDTHS = new WeakMap()

/**
 * The attributes a card can show, in reading order.
 *
 * Order is deliberate: what the parcel IS, then how it is judged, then how big
 * it is and what it is worth. A reader comparing two cards finds the same fact
 * in the same place on both.
 */
const CARD_FIELDS = Object.freeze([
  { key: 'broadType', label: 'Broad habitat' },
  { key: 'condition', label: 'Condition' },
  { key: 'distinctiveness', label: 'Distinctiveness' },
  { key: 'strategicSignificance', label: 'Strategic significance' },
  { key: 'retentionCategory', label: 'Retention' },
  { key: 'spatialRiskCategory', label: 'Spatial risk' },
  { key: 'area', label: 'Size' },
  // Post-intervention only. Every one of these is absent on a baseline parcel,
  // and absent lines are omitted, so a baseline card is simply shorter.
  { key: 'difficulty', label: 'Creation difficulty' },
  { key: 'standardTimeToTargetCondition', label: 'Time to target' },
  { key: 'advanceOrDelay', label: 'Advance or delay' },
  { key: 'finalTimeToTargetCondition', label: 'Final time to target' },
  { key: 'units', label: 'Biodiversity units' },
  { key: 'status', label: 'Calculation' },
  { key: 'surveyDate', label: 'Surveyed' },
  // Free text, so these wrap. Last, because an unbounded field in the middle
  // would push the fixed ones around from card to card and stop a reader
  // finding the same fact in the same place on each.
  { key: 'surveyDetails', label: 'Survey details', wraps: true },
  { key: 'comment', label: 'Comment', wraps: true }
])

async function addHabitatCards({
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

  // Every card's map is the same square, so one measurement settles the credit
  // for all of them — and, because no OS mapping is drawn into a frame that
  // cannot carry its credit, settles whether they get a basemap at all.
  const credit = withBasemap
    ? fitCredit(doc, mapFrame(MARGIN), [attribution, attributionShort])
    : null

  const thumbnails = await prepareThumbnails({
    features,
    grid,
    tileSource,
    withBasemap: Boolean(credit),
    size: CARD_MAP_SIZE
  })

  addCards({
    doc,
    section,
    features,
    thumbnails,
    site,
    style,
    grid,
    credit,
    stats
  })
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
        'Each parcel is shown as a card: its shape and position among the neighbouring ' +
          'parcels, and its recorded attributes, each on its own line. Every value shown ' +
          'on a mini-map is also given as text on the same card, so no information depends ' +
          'on seeing the picture. ',
        { width: CONTENT_WIDTH }
      )
    })
  )
}

function addCards({
  doc,
  section,
  features,
  thumbnails,
  site,
  style,
  grid,
  credit,
  stats
}) {
  let y = doc.y + CARD_TOP_GAP

  for (const feature of features) {
    const values = cardValues(feature)
    const height = cardHeight(doc, values)

    if (y + height > A4_PORTRAIT_HEIGHT - MARGIN) {
      doc.addPage()
      y = MARGIN
    }

    section.add(
      buildCard({
        doc,
        feature,
        values,
        y,
        height,
        style,
        site,
        grid,
        thumbnail: thumbnails.get(feature),
        credit,
        stats
      })
    )
    y += height + CARD_GAP
    stats.habitats += 1
  }
}

/**
 * A card is as tall as its content, with a floor of the map it contains.
 *
 * The map is the tallest fixed thing on the card, so a parcel with only two
 * recorded attributes still gets a card big enough to draw it in.
 *
 * Measured rather than counted, because two of the fields are free text and
 * wrap. `heightOfString` asks pdfkit the same question the renderer will answer
 * when it draws, at the same width and font — the alternative is guessing at a
 * line count and finding out it was wrong by overrunning the card's own frame.
 */
function cardHeight(doc, values) {
  const textHeight =
    CARD_HEADING_HEIGHT + fieldsHeight(doc, values) + CARD_PADDING * 2
  return Math.max(textHeight, CARD_MAP_SIZE + CARD_PADDING * 2)
}

/** The stacked height of every line this card will draw. */
function fieldsHeight(doc, values) {
  return presentFields(values).reduce(
    (total, field) => total + fieldHeight(doc, values, field),
    0
  )
}

function fieldHeight(doc, values, { key, wraps }) {
  if (!wraps) {
    return CARD_LINE_HEIGHT
  }
  // BOLD, not BODY: the value is drawn bold, and bold is the wider of the two.
  // Measuring in the lighter face reports fewer lines than the renderer will
  // draw, and the overflow lands outside the card's own border.
  doc.font(BOLD).fontSize(FONT_SIZE.bodySmall)
  const measured = doc.heightOfString(`${values[key]} `, {
    width: valueWidth(doc),
    ...dataText()
  })
  return Math.max(CARD_LINE_HEIGHT, measured)
}

/** Text column geometry, in one place so measuring and drawing cannot disagree. */
function textWidth() {
  return CONTENT_WIDTH - CARD_PADDING * 2 - CARD_MAP_SIZE - CARD_GUTTER
}

/**
 * The label column, measured from the labels rather than assumed.
 *
 * A label that does not fit its column wraps to a second line, and a
 * non-wrapping field advances by exactly one line height — so the wrapped label
 * would be drawn straight through the row beneath it. Sizing the column to the
 * widest label makes that impossible instead of merely unlikely.
 *
 * Measured rather than fixed because the typeface is a deployment option (see
 * services/report/fonts.js). "Strategic significance:" needs 94pt of the 96pt a
 * constant would have given it, so any face a shade wider than Noto Sans would
 * have started overlapping rows — on the page only, with every test still green.
 */
function labelWidth(doc) {
  const cached = LABEL_WIDTHS.get(doc)
  if (cached !== undefined) {
    return cached
  }
  doc.font(BODY).fontSize(FONT_SIZE.bodySmall)
  const widest = Math.max(
    ...CARD_FIELDS.map(({ label }) => doc.widthOfString(`${label}: `))
  )
  const measured = Math.max(
    CARD_LABEL_WIDTH,
    Math.ceil(widest) + CARD_LABEL_GAP
  )
  LABEL_WIDTHS.set(doc, measured)
  return measured
}

function valueWidth(doc) {
  return textWidth() - labelWidth(doc)
}

/** Only the fields this parcel actually has a value for. */
function presentFields(values) {
  return CARD_FIELDS.filter(({ key }) => values[key] !== null)
}

function mapFrame(y) {
  return {
    x: MARGIN + CARD_PADDING,
    y: y + CARD_PADDING,
    width: CARD_MAP_SIZE,
    height: CARD_MAP_SIZE
  }
}

function buildCard({
  doc,
  feature,
  values,
  y,
  height,
  style,
  site,
  grid,
  thumbnail,
  credit,
  stats
}) {
  drawCardFrame(doc, y, height)

  const frame = mapFrame(y)

  // Order matters, and getting it wrong is silent: the marked-content sequence
  // must be OPEN before anything is drawn into it. Drawing first and marking
  // afterwards yields a Figure wrapping an empty sequence, with every drawing
  // operation left untagged — PDF/UA 7.1-3. See habitat-pages.js.
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

  // Outside the Figure's sequence, as an artifact: the credit is not part of
  // what the picture shows, and one announcement per parcel would be dozens of
  // interruptions. Page 1 carries the wording into the reading order once.
  if (thumbnail.tiles) {
    labelAsArtifact(doc, () => drawCredit(doc, frame, credit))
  }

  const textX = MARGIN + CARD_PADDING + CARD_MAP_SIZE + CARD_GUTTER

  return doc.struct('Sect', [
    cardHeading(doc, values, textX, y + CARD_PADDING, textWidth()),
    cardFigure(doc, frame, values, figureContent),
    ...cardLines(doc, values, textX, y + CARD_PADDING + CARD_HEADING_HEIGHT)
  ])
}

/**
 * The parcel's identity, as a real heading.
 *
 * H3 because the section's own heading is an H2. A screen reader can then jump
 * card to card by heading, which is the navigation a table would have given
 * through its rows.
 */
function cardHeading(doc, values, x, y, width) {
  return doc.struct('H3', () => {
    doc.font(BOLD).fontSize(FONT_SIZE.subHeading).fillColor(INK)
    doc.text(`${values.ref} — ${values.type} `, x, y, { width, ...dataText() })
  })
}

/**
 * One paragraph per attribute, drawn as a label and a value.
 *
 * Visually two columns; semantically one sentence, "Condition: Poor". That is
 * what removes the need for the table `/Headers` the hand-laid layout cannot
 * emit — there is no cell to associate with a header, because there is no cell.
 */
function cardLines(doc, values, x, top) {
  let lineY = top
  return presentFields(values).map((field) => {
    const at = lineY
    lineY += fieldHeight(doc, values, field)
    return doc.struct('P', () => {
      doc.fontSize(FONT_SIZE.bodySmall)
      doc.font(BODY).fillColor(MUTED)
      doc.text(`${field.label}: `, x, at, {
        width: labelWidth(doc),
        continued: false
      })
      doc.font(BOLD).fillColor(INK)
      doc.text(`${values[field.key]} `, x + labelWidth(doc), at, {
        width: valueWidth(doc),
        ...dataText()
      })
    })
  })
}

/**
 * The alt text repeats no data — the card's own lines carry it — so it
 * describes only what the picture adds: shape and position.
 */
function cardFigure(doc, frame, values, figureContent) {
  return doc.struct(
    'Figure',
    {
      alt:
        `Outline of parcel ${values.ref}, shown in place among the ` +
        'neighbouring parcels. ',
      bbox: [frame.x, frame.y, frame.x + frame.width, frame.y + frame.height]
    },
    [figureContent]
  )
}

function drawCardFrame(doc, y, height) {
  labelAsArtifact(doc, () => {
    doc.save().lineWidth(RULE_WIDTH.frame).strokeColor(BORDER)
    doc.rect(MARGIN, y, CONTENT_WIDTH, height).stroke()
    doc.restore()
  })
}

/**
 * Everything a card can show, already formatted, with `null` for anything the
 * project does not hold. `ref` and `type` are exempt: they identify the parcel
 * and go in the heading, so they fall back to a dash rather than disappearing.
 */
function cardValues({ properties }) {
  const sqm = properties.sizeSquareMetres
  return {
    ref: properties.ref ?? '—',
    type: properties.type ?? '—',
    broadType: properties.broadType ?? null,
    // "Poor (1)" rather than two lines: the same shape the habitat detail
    // screens use, so a reader moving between the service and the report sees
    // the band and its score written the same way.
    condition: withScore(properties.condition, properties.conditionScore),
    distinctiveness: withScore(
      properties.distinctiveness,
      properties.distinctivenessScore
    ),
    strategicSignificance: properties.strategicSignificance ?? null,
    retentionCategory: normaliseRetentionCategory(properties.retentionCategory),
    spatialRiskCategory: properties.spatialRiskCategory ?? null,
    area: Number.isFinite(sqm)
      ? `${(sqm / SQ_M_PER_HECTARE).toFixed(PARCEL_HECTARE_DECIMALS)} ha`
      : null,
    difficulty: withScore(
      properties.difficulty,
      properties.difficultyMultiplier
    ),
    standardTimeToTargetCondition: yearsOrNull(
      properties.standardTimeToTargetCondition
    ),
    advanceOrDelay: properties.advanceOrDelay ?? null,
    finalTimeToTargetCondition: yearsOrNull(
      properties.finalTimeToTargetCondition
    ),
    units: Number.isFinite(properties.units)
      ? properties.units.toFixed(UNIT_DECIMALS)
      : null,
    status: properties.status ?? null,
    surveyDate: properties.surveyDate ?? null,
    surveyDetails: properties.surveyDetails ?? null,
    comment: properties.comment ?? null
  }
}

/**
 * "1. Retained" -> "Retained".
 *
 * The backend normalises the raw GeoPackage value when it decides which engine
 * calculation to run, but never writes the normalised value back, so the
 * project document keeps whatever the upload carried. The service normalises
 * again on display; the report has to do the same, or the report and the screen
 * it was generated from describe the same parcel differently.
 */
function normaliseRetentionCategory(value) {
  if (typeof value !== 'string') {
    return null
  }
  return value.trim().replace(/^\d+\.\s*/u, '') || null
}

/** "Low (2)" where a score is known, "Low" where it is not, null where neither. */
function withScore(value, score) {
  if (!value) {
    return null
  }
  return Number.isFinite(score) ? `${value} (${score})` : String(value)
}

/**
 * Time to target arrives as a number of years or as text the engine already
 * worded. A bare number reads wrong on a line labelled only "Time to target".
 */
function yearsOrNull(value) {
  if (Number.isFinite(value)) {
    return `${value} ${value === 1 ? 'year' : 'years'}`
  }
  return value || null
}

export { CARD_FIELDS, addHabitatCards, cardHeight, cardValues, labelWidth }
