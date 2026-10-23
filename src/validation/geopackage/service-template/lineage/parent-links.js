import { FEATURE_UUID, PARENT_GEOM, PARENT_UUID } from 'bng-library/bng-service'

import { ERROR_CODES, makeError } from '../../errors.js'
import {
  canonicalGeometriesMatch,
  canonicalGeometry,
  canonicalGeometryFromWkt,
  canonicalGeometryStrippedFirst
} from './canonical-geometry.js'

/**
 * The parent links of a BNG Service template file (BMD-1083): whether each
 * post-intervention row that names a baseline parent, by `parent_uuid`, can be
 * trusted. The units cannot be calculated accurately from a link that cannot,
 * so either problem refuses the file:
 *
 * - no parent link: a Retained or Enhanced row, which carries a baseline
 *   habitat forward, names no parent, so it is not known which one;
 * - a missing parent: `parent_uuid` names no baseline feature of the layer;
 * - an ambiguous parent: `parent_uuid` names a `feature_uuid` that more than
 *   one baseline feature of the layer has, as a pasted copy can, so which
 *   one the row continues, and whose length it is priced on, is not known;
 * - a parent shape changed: the row's `parent_geom`, the parent's shape when
 *   the row was copied, pasted or last refreshed, no longer matches the
 *   parent's baseline shape, so the baseline was edited after the copy. A
 *   linked row whose `parent_geom` is missing, empty, not valid WKT or over
 *   MAX_PARENT_GEOM_CHARS cannot be checked, and is refused the same way.
 *
 * Apart from the first, the checks follow the link, not the Retention
 * Category: a Created row with no `parent_uuid` is a creation and is not
 * checked, and one with a link is checked like any other. Shapes are compared
 * as canonical-geometry.js compares them.
 */

/** The layers whose links are checked: the habitat layers the service reads. */
const LINKED_LAYERS = Object.freeze(['areas', 'hedgerows', 'watercourses'])

/** The pipeline's name for a habitat's Habitat Ref. */
const REF = 'Parcel Ref'
const RETENTION_CATEGORY = 'Retention Category'

/** The Retention Categories that carry a baseline habitat forward. */
const CONTINUING = new Set(['retained', 'enhanced'])

/** Each layer's habitat type column, at each stage. */
const HABITAT_TYPE = Object.freeze({
  areas: ['Baseline Habitat Type', 'Proposed Habitat Type'],
  hedgerows: ['Baseline Hedge Type', 'Proposed Hedge Type'],
  watercourses: ['Baseline River Type', 'Proposed River Type']
})

/**
 * The longest `parent_geom` text that is read. A vertex at 3 decimals in
 * British National Grid takes about 25 characters, so this holds a parent of
 * some 300,000 vertices, far beyond any surveyed feature. A longer text cannot
 * be checked, and is refused unread.
 */
export const MAX_PARENT_GEOM_CHARS = 8_000_000

const SAMPLE_CAP = 50

const isBlank = (value) =>
  value === null ||
  value === undefined ||
  (typeof value === 'string' && value.trim() === '')

const text = (value) => (isBlank(value) ? null : String(value).trim())

/** `compute`, with each key's result worked out at most once. */
function memoise(compute) {
  const results = new Map()
  return (key) => {
    if (!results.has(key)) {
      results.set(key, compute(key))
    }
    return results.get(key)
  }
}

/**
 * Canonical shapes for one check, each worked out at most once: a parent's
 * shape however many rows name it, and a recorded `parent_geom` however many
 * rows share the text. A parent has two canonical forms (see
 * canonical-geometry.js); the second is worked out only when the first does
 * not match.
 */
function createShapeCache() {
  const roundedFirst = memoise((parent) =>
    canonicalGeometry(parent.nativeGeometry)
  )
  const strippedFirst = memoise((parent) =>
    canonicalGeometryStrippedFirst(parent.nativeGeometry)
  )
  // Measured before it is trimmed or read: the cap is on the text uploaded.
  const recorded = memoise((wkt) =>
    typeof wkt !== 'string' || wkt.length > MAX_PARENT_GEOM_CHARS
      ? null
      : canonicalGeometryFromWkt(wkt)
  )
  return (wkt, parent) => {
    const shape = recorded(wkt)
    return (
      shape !== null &&
      (canonicalGeometriesMatch(shape, roundedFirst(parent)) ||
        canonicalGeometriesMatch(shape, strippedFirst(parent)))
    )
  }
}

/** The baseline features of a layer, by `feature_uuid`: each uuid's list. */
function parentsByUuid(baseline) {
  const parents = new Map()
  for (const feature of baseline) {
    const uuid = text(feature.properties?.[FEATURE_UUID])
    if (uuid !== null) {
      parents.set(uuid, [...(parents.get(uuid) ?? []), feature])
    }
  }
  return parents
}

function habitatTypeOf(layer, properties) {
  const [baselineType, proposedType] = HABITAT_TYPE[layer]
  return text(properties[proposedType]) ?? text(properties[baselineType])
}

const continues = (properties) =>
  CONTINUING.has(text(properties[RETENTION_CATEGORY])?.toLowerCase())

/** A post-intervention row whose parent link is wrong. */
function offendingRow(layer, table, feature) {
  const { properties } = feature
  return {
    layer,
    table,
    fid: properties.fid,
    ref: text(properties[REF]),
    habitatType: habitatTypeOf(layer, properties),
    parentUuid: text(properties[PARENT_UUID])
  }
}

/** A baseline parent whose shape its post-intervention rows do not record. */
function changedParent(layer, table, parent) {
  const { properties } = parent
  return {
    layer,
    table,
    fid: properties.fid,
    ref: text(properties[REF]),
    habitatType: text(properties[HABITAT_TYPE[layer][0]]),
    childRefs: []
  }
}

/** A `feature_uuid` that more than one baseline feature has. */
function ambiguousParent(layer, table, uuid, parents) {
  return {
    layer,
    table,
    parentUuid: uuid,
    refs: parents.map(({ properties }) => text(properties[REF])),
    habitatType: text(parents[0].properties[HABITAT_TYPE[layer][0]]),
    childRefs: []
  }
}

/** Add a row's Habitat Ref to the entry for `key`, made by `make` if new. */
function addChild(entries, key, make, feature) {
  const entry = entries.get(key) ?? make()
  entry.childRefs.push(text(feature.properties[REF]))
  entries.set(key, entry)
}

/**
 * Check one post-intervention row's link, recording what is wrong with it in
 * `found`. A row that names no parent is checked only if it carries one
 * forward; a row that names one is checked whatever its Retention Category.
 */
function checkRow(feature, { layer, tables, parents, matches, found }) {
  const properties = feature.properties ?? {}
  const uuid = text(properties[PARENT_UUID])
  const named = uuid === null ? undefined : parents.get(uuid)
  if (uuid === null) {
    if (continues(properties)) {
      found.unlinked.push(offendingRow(layer, tables.postIntervention, feature))
    }
  } else if (!named) {
    found.missing.push(offendingRow(layer, tables.postIntervention, feature))
  } else if (named.length > 1) {
    addChild(
      found.ambiguous,
      uuid,
      () => ambiguousParent(layer, tables.baseline, uuid, named),
      feature
    )
  } else if (!matches(properties[PARENT_GEOM], named[0])) {
    addChild(
      found.changed,
      named[0],
      () => changedParent(layer, tables.baseline, named[0]),
      feature
    )
  }
}

/** One layer's unlinked rows and missing, ambiguous and changed parents. */
function checkLayer(layer, baseline, postIntervention) {
  const context = {
    layer,
    tables: {
      baseline: baseline.table,
      postIntervention: postIntervention.table
    },
    parents: parentsByUuid(baseline.features),
    matches: createShapeCache(),
    found: {
      unlinked: [],
      missing: [],
      ambiguous: new Map(),
      changed: new Map()
    }
  }
  for (const feature of postIntervention.features) {
    checkRow(feature, context)
  }
  const { unlinked, missing, ambiguous, changed } = context.found
  return {
    unlinked,
    missing,
    ambiguous: [...ambiguous.values()],
    changed: [...changed.values()]
  }
}

function label(offender) {
  const name = offender.ref ?? `fid ${offender.fid}`
  const habitatType = offender.habitatType ? ` (${offender.habitatType})` : ''
  return `${offender.table} ${name}${habitatType}`
}

function collated(code, heading, offenders, describe) {
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

/**
 * Check the parent link of every linked post-intervention row.
 *
 * @param {object} baselineLayers readGeoPackage's Baseline tables, read with
 *   their geometry (FEATURE_READ_MODE.full)
 * @param {object} postInterventionLayers readGeoPackage's Post-Intervention
 *   tables; their attributes are enough
 * @returns {Array<{ code: string, message: string, details: object }>} one
 *   error per kind of problem, listing every row or parent it applies to
 */
export function checkParentLinks(baselineLayers, postInterventionLayers) {
  const unlinked = []
  const missing = []
  const ambiguous = []
  const changed = []
  for (const layer of LINKED_LAYERS) {
    const found = checkLayer(
      layer,
      {
        table: baselineLayers.layerTables?.[layer],
        features: baselineLayers[layer] ?? []
      },
      {
        table: postInterventionLayers.layerTables?.[layer],
        features: postInterventionLayers[layer] ?? []
      }
    )
    unlinked.push(...found.unlinked)
    missing.push(...found.missing)
    ambiguous.push(...found.ambiguous)
    changed.push(...found.changed)
  }
  return [
    collated(
      ERROR_CODES.STAGED_PARENT_LINK_MISSING,
      'One or more Retained or Enhanced post-intervention habitats do not name the baseline habitat they continue',
      unlinked,
      label
    ),
    collated(
      ERROR_CODES.STAGED_UNKNOWN_PARENT_REF,
      'One or more post-intervention habitats name a baseline habitat that is not in the file',
      missing,
      label
    ),
    collated(
      ERROR_CODES.STAGED_AMBIGUOUS_PARENT,
      'One or more post-intervention habitats name a baseline habitat whose feature_uuid more than one baseline habitat has',
      ambiguous,
      (parent) =>
        `${parent.table} ${parent.refs.join(', ')}, named by ${parent.childRefs.join(', ')}`
    ),
    collated(
      ERROR_CODES.STAGED_BASELINE_DRIFTED,
      'One or more baseline habitats do not have the shape their post-intervention habitats were copied from',
      changed,
      (parent) => `${label(parent)}, copied to ${parent.childRefs.join(', ')}`
    )
  ].filter(Boolean)
}
