import { HABITAT_REF } from 'bng-library/bng-service'

import { ERROR_CODES, makeError } from './errors.js'
import { PROP_KEYS, pickProp } from './properties.js'
import { SQ_METRES_PER_HECTARE } from './tree-sizes.js'
import { shownValue } from './text-limits.js'

const SAMPLE_CAP = 50

/** The layer the check reads: a BNG Service template's vertical area habitats. */
const VERTICAL_LAYER = 'verticalHabitats'

/** The column name quoted back to the user, as the template labels it. */
const AREA_COLUMN = 'Area (ha)'

/** A decimal number as text: digits, with or without a fraction. */
const DECIMAL_TEXT = /^\s*\d+(\.\d+)?\s*$/

/**
 * Significant figures a typed area keeps in square metres. A double holds 15,
 * so this drops only the noise hectares to square metres adds: 0.07 ha is
 * 700 m², not 700.0000000000001.
 */
const SIGNIFICANT_FIGURES = 15

/**
 * A vertical area habitat's Area as typed, in hectares, or null when it is
 * not a number above 0.
 *
 * The surveyor types the area they estimated on site: QGIS cannot measure it
 * from the line along the structure's base. The template declares the column
 * a real, so SQLite hands back a number for anything it could read as one,
 * and text only for what it could not. Text is taken only when it spells a
 * plain decimal, since `Number("0x3")` is 3.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function verticalAreaHectares(value) {
  const number =
    typeof value === 'string' && DECIMAL_TEXT.test(value)
      ? Number(value)
      : value
  return typeof number === 'number' && Number.isFinite(number) && number > 0
    ? number
    : null
}

/**
 * A vertical area habitat's Area in square metres, as every area habitat's
 * size is stored, or null when it is not a number above 0. The template's
 * Area is in hectares, like the Area Habitats layers'.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function verticalAreaSquareMetres(value) {
  const hectares = verticalAreaHectares(value)
  return hectares === null
    ? null
    : Number(
        (hectares * SQ_METRES_PER_HECTARE).toPrecision(SIGNIFICANT_FIGURES)
      )
}

function describe(feature, idx, table) {
  const properties = feature?.properties ?? {}
  const ref = pickProp(properties, PROP_KEYS.parcelRef)
  const fid = pickProp(properties, PROP_KEYS.fid)
  return {
    layer: VERTICAL_LAYER,
    ...(table && { table }),
    feature_ref: ref == null || ref === '' ? null : String(ref),
    fid: fid == null || fid === '' ? null : fid,
    idx,
    area: pickProp(properties, PROP_KEYS.verticalArea) ?? null
  }
}

function labelOf(sample) {
  const name = sample.table ?? VERTICAL_LAYER
  if (sample.feature_ref != null) {
    return `${name} ${HABITAT_REF} ${shownValue(sample.feature_ref)}`
  }
  if (sample.fid != null) {
    return `${name} fid ${sample.fid}`
  }
  return `${name} feature #${sample.idx}`
}

const shownArea = (area) => (area == null ? 'blank' : String(area))

/**
 * Refuse vertical area habitats whose Area is blank, zero, negative or not a
 * number. Without it the habitat has no size to be priced on, and a
 * negative area would take units away.
 *
 * @param {object} layers Output of readGeoPackage
 * @returns {{ code: string, message: string, details: { count: number, sample: object[] } }|null}
 */
export function checkVerticalHabitatAreas(layers) {
  const table = layers?.layerTables?.[VERTICAL_LAYER]
  const offenders = []
  const features = layers?.[VERTICAL_LAYER] ?? []
  features.forEach((feature, idx) => {
    const area = pickProp(feature?.properties, PROP_KEYS.verticalArea)
    if (verticalAreaHectares(area) === null) {
      offenders.push(describe(feature, idx, table))
    }
  })

  if (offenders.length === 0) {
    return null
  }

  const sample = offenders.slice(0, SAMPLE_CAP)
  const shown = sample
    .map((entry) => `${labelOf(entry)} (${shownArea(entry.area)})`)
    .join(', ')
  const more =
    offenders.length > sample.length
      ? ` (and ${offenders.length - sample.length} more)`
      : ''

  return makeError(
    ERROR_CODES.VERTICAL_HABITAT_AREA_NOT_POSITIVE,
    `One or more vertical area habitats have an "${AREA_COLUMN}" that is not a number above 0. Enter the area you estimated on site, in hectares: ${shown}${more}`,
    { count: offenders.length, sample }
  )
}
