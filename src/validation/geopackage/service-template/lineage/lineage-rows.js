import { FEATURE_UUID } from 'bng-library/bng-service'

import { makeError } from '../../errors.js'

/**
 * What the lineage checks of a BNG Service template file (BMD-1083) share:
 * how they read a row of the template's habitat tables, find the baseline
 * feature a row names, and report the rows or parents a check refuses.
 *
 * The rows are readGeoPackage's, with their columns under the names the
 * pipeline reads them by (template-mapping.js).
 */

/** The layers whose links are checked: the habitat layers the service reads. */
export const LINKED_LAYERS = Object.freeze([
  'areas',
  'hedgerows',
  'watercourses'
])

/** The pipeline's name for a habitat's Habitat Ref. */
export const REF = 'Parcel Ref'
export const RETENTION_CATEGORY = 'Retention Category'

/** The Retention Categories that carry a baseline habitat forward. */
const CONTINUING = new Set(['retained', 'enhanced'])
const CREATED = 'created'

/** Each layer's habitat type column, at each stage. */
export const HABITAT_TYPE = Object.freeze({
  areas: ['Baseline Habitat Type', 'Proposed Habitat Type'],
  hedgerows: ['Baseline Hedge Type', 'Proposed Hedge Type'],
  watercourses: ['Baseline River Type', 'Proposed River Type']
})

const SAMPLE_CAP = 50

const isBlank = (value) =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '')

/** A cell as trimmed text, or null when it is blank. */
export const text = (value) => (isBlank(value) ? null : String(value).trim())

const retentionOf = (properties) =>
  text(properties[RETENTION_CATEGORY])?.toLowerCase()

/** Whether a row carries a baseline habitat forward: Retained or Enhanced. */
export const continues = (properties) => CONTINUING.has(retentionOf(properties))

/** Whether a row is a creation, linked to a parent or not. */
export const isCreated = (properties) => retentionOf(properties) === CREATED

/** A post-intervention row's habitat type, or its baseline one if it has none. */
export function habitatTypeOf(layer, properties) {
  const [baselineType, proposedType] = HABITAT_TYPE[layer]
  return text(properties[proposedType]) ?? text(properties[baselineType])
}

/** A baseline feature's habitat type. */
export function baselineHabitatTypeOf(layer, properties) {
  return text(properties[HABITAT_TYPE[layer][0]])
}

/** The baseline features of a layer, by `feature_uuid`: each uuid's list. */
export function parentsByUuid(baseline) {
  const parents = new Map()
  for (const feature of baseline) {
    const uuid = text(feature.properties?.[FEATURE_UUID])
    if (uuid !== null) {
      parents.set(uuid, [...(parents.get(uuid) ?? []), feature])
    }
  }
  return parents
}

/** How a message names a row or parent: its table, ref and habitat type. */
export function label(offender) {
  const name = offender.ref ?? `fid ${offender.fid}`
  const habitatType = offender.habitatType ? ` (${offender.habitatType})` : ''
  return `${offender.table} ${name}${habitatType}`
}

/**
 * One error for every offender of a kind, as the drop-out page shows one
 * message for them all; null when there are none.
 */
export function collated(code, heading, offenders, describe) {
  if (offenders.length === 0) {
    return null
  }
  const sample = offenders.slice(0, SAMPLE_CAP)
  const more =
    offenders.length > sample.length
      ? ` (and ${offenders.length - sample.length} more)`
      : ''
  return makeError(
    code,
    `${heading}: ${sample.map(describe).join('; ')}${more}`,
    { count: offenders.length, sample }
  )
}
