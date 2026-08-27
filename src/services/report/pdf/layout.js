/**
 * Page geometry, palette and typography for the site report.
 *
 * One module so the two page builders agree by construction rather than by
 * two copies of the same number staying in step, and so a typographic change
 * is made in one place.
 */

const A4_PORTRAIT_WIDTH = 595.28
const A4_PORTRAIT_HEIGHT = 841.89
const A4_PORTRAIT = Object.freeze([A4_PORTRAIT_WIDTH, A4_PORTRAIT_HEIGHT])

const MARGIN = 40
const CONTENT_WIDTH = A4_PORTRAIT_WIDTH - MARGIN * 2

// GOV.UK palette (govuk-frontend colour names).
const INK = '#0b0c0c'
const MUTED = '#505a5f'
const BORDER = '#b1b4b6'
const MAP_GROUND = '#f3f2f1'
const CONTEXT_FILL = '#d8d4d0'
const CONTEXT_STROKE = '#b1b4b6'

const FONT_SIZE = Object.freeze({
  title: 22,
  sectionHeading: 15,
  subHeading: 14,
  intro: 10,
  body: 9.5,
  bodySmall: 9,
  tableCell: 8.5,
  legend: 7.5,
  attribution: 7
})

const RULE_WIDTH = Object.freeze({
  frame: 0.6,
  rowDivider: 0.4,
  headerUnderline: 1,
  miniMapFrame: 0.5,
  keyFiguresHeader: 1.5,
  keyFiguresRow: 0.5
})

const SITE_MAP_HEIGHT = 210
const SITE_MAP_GUTTER = 16
const SITE_MAP_LABEL_HEIGHT = 14
const SITE_MAP_TOP_GAP = 6
const SITE_MAP_BOTTOM_GAP = 26
const SCALE_BAR_INSET = 6
const SCALE_BAR_BOTTOM_OFFSET = 14
const SCALE_BAR_WIDTH_FRACTION = 3

const MINI_MAP_SIZE = 52
const MINI_MAP_COLUMN_PADDING = 10
const MINI_MAP_INSET = 2
const HABITAT_ROW_HEIGHT = 62
const HABITAT_ROW_TEXT_OFFSET = 6
const HABITAT_ROW_MAP_OFFSET = 3
const HABITAT_ROW_DIVIDER_OFFSET = 4
const HEADER_ROW_HEIGHT = 20
const HEADER_UNDERLINE_OFFSET = 14
const CELL_PADDING = 6

const MAP_PAD = 0.08
const MINI_MAP_PAD = 0.35
const CONTEXT_FILL_OPACITY = 0.45
const CONTEXT_LINE_WIDTH = 0.3
const SUBJECT_LINE_WIDTH = 0.8
const LEGEND_SWATCH = 8
const LEGEND_SWATCH_GAP = 4
const LEGEND_OPACITY = 0.75
const LEGEND_HEIGHT = 20
const LEGEND_LINE_GAP = -1
const LEGEND_TOP_OFFSET = 1

const KEY_FIGURES_COLUMN_WIDTH = 110

/** Column widths as fractions of the space the thumbnail column leaves. */
const HABITAT_COLUMN_FRACTION = Object.freeze({
  ref: 0.12,
  type: 0.4,
  condition: 0.26,
  area: 0.22
})

const SQ_M_PER_HECTARE = 10_000
const HECTARE_DECIMALS = 2
const PARCEL_HECTARE_DECIMALS = 3
const UNIT_DECIMALS = 2

/**
 * Target print density for the parcel thumbnails. Lower than the site map's
 * because a thumbnail is 18 mm square: on a large site the thumbnail basemaps
 * are what take the document from under 1 MB to several, and halving this is
 * invisible at that size. Tune here before dropping the basemap entirely.
 */
const THUMBNAIL_TARGET_DPI = 150

export {
  A4_PORTRAIT,
  A4_PORTRAIT_HEIGHT,
  BORDER,
  CELL_PADDING,
  CONTENT_WIDTH,
  CONTEXT_FILL,
  CONTEXT_FILL_OPACITY,
  CONTEXT_LINE_WIDTH,
  CONTEXT_STROKE,
  FONT_SIZE,
  HABITAT_COLUMN_FRACTION,
  HABITAT_ROW_DIVIDER_OFFSET,
  HABITAT_ROW_HEIGHT,
  HABITAT_ROW_MAP_OFFSET,
  HABITAT_ROW_TEXT_OFFSET,
  HEADER_ROW_HEIGHT,
  HEADER_UNDERLINE_OFFSET,
  HECTARE_DECIMALS,
  INK,
  KEY_FIGURES_COLUMN_WIDTH,
  LEGEND_HEIGHT,
  LEGEND_LINE_GAP,
  LEGEND_OPACITY,
  LEGEND_SWATCH,
  LEGEND_SWATCH_GAP,
  LEGEND_TOP_OFFSET,
  MAP_GROUND,
  MAP_PAD,
  MARGIN,
  MINI_MAP_COLUMN_PADDING,
  MINI_MAP_INSET,
  MINI_MAP_PAD,
  MINI_MAP_SIZE,
  MUTED,
  PARCEL_HECTARE_DECIMALS,
  RULE_WIDTH,
  SCALE_BAR_BOTTOM_OFFSET,
  SCALE_BAR_INSET,
  SCALE_BAR_WIDTH_FRACTION,
  SITE_MAP_BOTTOM_GAP,
  SITE_MAP_GUTTER,
  SITE_MAP_HEIGHT,
  SITE_MAP_LABEL_HEIGHT,
  SITE_MAP_TOP_GAP,
  SQ_M_PER_HECTARE,
  SUBJECT_LINE_WIDTH,
  THUMBNAIL_TARGET_DPI,
  UNIT_DECIMALS
}
