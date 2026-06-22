import { randomUUID } from 'node:crypto'

import {
  getIndividualTreeAreaHectares,
  BaselineLookupError
} from 'bng-metric-engine'

import { PROP_KEYS, featureKeysForVariant, pickProp } from './properties.js'
import {
  areaStatus,
  hedgerowStatus,
  watercourseStatus
} from '../../services/baseline/calculate-habitat-statuses.js'
import {
  INDIVIDUAL_TREES_BROAD_HABITAT,
  URBAN_TREE_TYPE,
  RURAL_TREE_TYPE,
  treeHabitatTypeFromRuralUrban
} from './tree-constants.js'
import { stripConditionPrefix } from '../../utilities/baseline/condition.js'

/** Individual trees store area in hectares; persisted sizes are in m². */
const SQ_METRES_PER_HECTARE = 10_000

/**
 * @param {number | null | undefined} sizeSquareMetres
 * @returns {number | null}
 */
function areaFromSizeSquareMetres(sizeSquareMetres) {
  if (
    typeof sizeSquareMetres !== 'number' ||
    !Number.isFinite(sizeSquareMetres)
  ) {
    return null
  }
  return Math.round(sizeSquareMetres)
}

// Survey / provenance / planning metadata columns common to the Habitats,
// Hedgerows and Rivers layers. These are single shared columns (no
// baseline/proposed variant), so they are read the same way for both document
// variants. Each entry is [documentField, propertyKeyAliases]; the matching
// Joi keys live in project.js (metadataSchemaKeys).
const METADATA_PROPS = [
  ['siteName', PROP_KEYS.siteName],
  ['surveyDate', PROP_KEYS.surveyDate],
  ['surveyDetails', PROP_KEYS.surveyDetails],
  ['comment', PROP_KEYS.comment],
  ['mappedBy', PROP_KEYS.mappedBy],
  ['company', PROP_KEYS.company],
  ['baseMap', PROP_KEYS.baseMap],
  ['location', PROP_KEYS.location],
  ['spatialRiskCategory', PROP_KEYS.spatialRiskCategory],
  ['habitatCreatedInAdvanceYears', PROP_KEYS.habitatCreatedInAdvanceYears],
  [
    'delayInStartingHabitatCreationYears',
    PROP_KEYS.delayInStartingHabitatCreationYears
  ]
]

/**
 * Resolve a list of [fieldName, keyAliases] entries against a properties bag.
 *
 * @param {object} props
 * @param {Array<[string, string[]]>} entries
 * @returns {Record<string, unknown>}
 */
function pickProps(props, entries) {
  return Object.fromEntries(
    entries.map(([name, keys]) => [name, pickProp(props, keys)])
  )
}

function buildHabitat(feature, keys) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const habitatType = pickProp(props, keys.habitatType)
  const ref = pickProp(props, keys.parcelRef)

  // NOTE: distinctiveness and distinctivenessScore are not included here because
  // they are calculated separately by the metric engine. rawDistinctiveness is
  // the verbatim GeoPackage distinctiveness column (Baseline/Proposed by variant),
  // preserved for reference only.
  // NOTE2: area is set from PostGIS habitatSizes (sizeSquareMetres) in extractHabitatData.

  const document = {
    featureId,
    ref,
    type: habitatType,
    broadType: pickProp(props, keys.broadHabitat),
    condition: stripConditionPrefix(pickProp(props, keys.condition)),
    strategicSignificance: pickProp(props, keys.strategicSignificance),
    retentionCategory: pickProp(props, PROP_KEYS.retentionCategory),
    rawDistinctiveness: pickProp(props, keys.rawDistinctiveness),
    ...pickProps(props, METADATA_PROPS),
    properties: props
  }
  document.status = areaStatus(document)
  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

/**
 * Resolve the notional m² area for an individual tree of the given size. Trees
 * are points, so the area is a fixed per-size lookup (bng-metric-engine) rather
 * than a PostGIS measurement. Returns null for a missing/unrecognised size.
 *
 * @param {unknown} treeSize
 * @returns {{ sizeSquareMetres: number, area: number } | { sizeSquareMetres: null, area: null }}
 */
function treeAreaFields(treeSize) {
  try {
    // The per-size reference areas in m² are whole numbers (e.g. 0.0163 ha →
    // 163 m²); rounding removes floating-point noise without losing precision.
    const sizeSquareMetres = Math.round(
      getIndividualTreeAreaHectares(treeSize) * SQ_METRES_PER_HECTARE
    )
    return { sizeSquareMetres, area: sizeSquareMetres }
  } catch (error) {
    if (error instanceof BaselineLookupError) {
      return { sizeSquareMetres: null, area: null }
    }
    throw error
  }
}

function buildTree(feature, keys) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const ref = pickProp(props, keys.treeRef)
  const treeSize = pickProp(props, keys.treeSize)
  const ruralOrUrban = pickProp(props, keys.ruralOrUrbanTree)

  const document = {
    featureId,
    ref,
    // Trees are treated as an area habitat: broad "Individual trees" with an
    // urban/rural habitat type that the engine reference data is keyed on.
    type: treeHabitatTypeFromRuralUrban(ruralOrUrban),
    broadType: INDIVIDUAL_TREES_BROAD_HABITAT,
    treeSize,
    treeSpecies: pickProp(props, keys.treeType),
    ruralOrUrban,
    count: pickProp(props, PROP_KEYS.treeCount),
    condition: stripConditionPrefix(pickProp(props, keys.condition)),
    strategicSignificance: pickProp(props, keys.strategicSignificance),
    retentionCategory: pickProp(props, PROP_KEYS.retentionCategory),
    ...pickProps(props, METADATA_PROPS),
    properties: props
  }
  const { sizeSquareMetres, area } = treeAreaFields(treeSize)
  document.sizeSquareMetres = sizeSquareMetres
  document.area = area
  document.status = areaStatus(document)

  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

function buildLinearFeature(
  feature,
  keys,
  typeKey,
  extraProperties,
  statusForDocument
) {
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  const ref = pickProp(props, keys.parcelRef)
  const extraDocumentProperties = pickProps(props, extraProperties)

  const document = {
    featureId,
    ref,
    type: pickProp(props, typeKey),
    condition: stripConditionPrefix(pickProp(props, keys.condition)),
    ...extraDocumentProperties,
    properties: props
  }
  document.status = statusForDocument(document)
  const geometryRow = {
    featureId,
    ref,
    geometry: feature.nativeGeometry,
    srid: feature.nativeSrid
  }
  return { document, geometryRow }
}

function buildHedgerow(feature, keys) {
  return buildLinearFeature(
    feature,
    keys,
    keys.hedgerowType,
    [
      ['strategicSignificance', keys.strategicSignificance],
      ['retentionCategory', PROP_KEYS.retentionCategory],
      ['rawDistinctiveness', keys.rawDistinctiveness],
      ...METADATA_PROPS
    ],
    hedgerowStatus
  )
}

function buildWatercourse(feature, keys) {
  return buildLinearFeature(
    feature,
    keys,
    keys.riverType,
    [
      ['riparianEncroachment', keys.riparianEncroachment],
      ['watercourseEncroachment', keys.watercourseEncroachment],
      ['strategicSignificance', keys.strategicSignificance],
      ['retentionCategory', PROP_KEYS.retentionCategory],
      ['enhancementType', PROP_KEYS.enhancementType],
      ['rawDistinctiveness', keys.rawDistinctiveness],
      ...METADATA_PROPS
    ],
    watercourseStatus
  )
}

function buildRedLine(features) {
  const feature = features?.[0]
  if (!feature) {
    return { document: null, geometryRow: null }
  }
  const featureId = feature.featureId ?? randomUUID()
  const props = feature.properties ?? {}
  return {
    document: {
      featureId,
      siteName: pickProp(props, PROP_KEYS.siteName),
      area: pickProp(props, PROP_KEYS.area),
      properties: props
    },
    geometryRow: {
      featureId,
      geometry: feature.nativeGeometry,
      srid: feature.nativeSrid
    }
  }
}

/**
 * Map an array of parsed GeoPackage features into parallel `documents` and
 * `geometries` arrays, splitting attribute data from geometry.
 *
 * @param {object[]} features
 * @param {(feature: object) => { document: object, geometryRow: object }} builder
 *   Per-feature transform, e.g. `buildHabitat` or a linear feature builder, that
 *   returns the JSONB-bound document and the matching PostGIS geometry row.
 */
function splitFeatures(features, builder, keys) {
  const documents = []
  const geometries = []
  for (const feature of features) {
    const { document, geometryRow } = builder(feature, keys)
    documents.push(document)
    geometries.push(geometryRow)
  }
  return { documents, geometries }
}

/**
 * @param {object[]} documents
 * @param {Array<{ featureId: string, sizeMetres: number }>} sizeEntries
 */
function embedLinearFeatureSizes(documents, sizeEntries) {
  const sizesByFeatureId = new Map(
    sizeEntries.map((entry) => [entry.featureId, entry.sizeMetres])
  )
  for (const document of documents) {
    document.sizeMetres = sizesByFeatureId.get(document.featureId) ?? null
  }
}

/**
 * Sum the notional tree areas (already embedded on each tree document by
 * buildTree), both overall and grouped by urban/rural habitat type — the
 * grouped totals the story requires the system to store per habitat type.
 *
 * @param {object[]} treeDocuments
 * @returns {{ totalSquareMetres: number, urbanSquareMetres: number, ruralSquareMetres: number }}
 */
function summarizeTreeSizes(treeDocuments) {
  // Sizes are summed per tree type; only the urban/rural buckets are read back,
  // so any unknown type still counts toward the total but not the split.
  const sizeByType = new Map()
  let totalSquareMetres = 0
  for (const tree of treeDocuments) {
    const size = tree.sizeSquareMetres
    if (typeof size !== 'number' || !Number.isFinite(size)) {
      continue
    }
    totalSquareMetres += size
    sizeByType.set(tree.type, (sizeByType.get(tree.type) ?? 0) + size)
  }
  return {
    totalSquareMetres,
    urbanSquareMetres: sizeByType.get(URBAN_TREE_TYPE) ?? 0,
    ruralSquareMetres: sizeByType.get(RURAL_TREE_TYPE) ?? 0
  }
}

/**
 * @param {object} habitats
 * @param {object} hedgerows
 * @param {object} watercourses
 * @param {object} trees
 * @param {object} habitatSizes
 * @returns {object}
 */
function embedHabitatSizes(
  habitats,
  hedgerows,
  watercourses,
  trees,
  habitatSizes
) {
  const {
    areaHabitats,
    hedgerows: hedgerowSizes,
    watercourses: wcSizes
  } = habitatSizes

  const areaSizesByFeatureId = new Map(
    areaHabitats.individualSquareMetres.map((entry) => [
      entry.featureId,
      entry.sizeSquareMetres
    ])
  )
  for (const document of habitats.documents) {
    const sizeSquareMetres =
      areaSizesByFeatureId.get(document.featureId) ?? null
    document.sizeSquareMetres = sizeSquareMetres
    document.area = areaFromSizeSquareMetres(sizeSquareMetres)
  }

  embedLinearFeatureSizes(hedgerows.documents, hedgerowSizes.individualMetres)
  embedLinearFeatureSizes(watercourses.documents, wcSizes.individualMetres)

  const treeSizes = summarizeTreeSizes(trees.documents)

  return {
    // "Total area size": area-habitat parcels plus individual trees. Trees are a
    // special area habitat, so their notional area is summed into the headline
    // area-habitats size shown on the habitat list.
    areaHabitats: {
      totalSquareMetres:
        areaHabitats.totalSquareMetres + treeSizes.totalSquareMetres
    },
    hedgerows: { totalMetres: hedgerowSizes.totalMetres },
    watercourses: { totalMetres: wcSizes.totalMetres },
    trees: treeSizes,
    // "Site" size: habitat parcel area EXCLUDING special habitats (currently
    // individual trees). This is the figure compared against the red line
    // boundary area, so the notional tree areas must not inflate it.
    site: { totalSquareMetres: areaHabitats.totalSquareMetres }
  }
}

/**
 * Shape an already-parsed `layers` object (from readBaselineGeoPackage) into
 * (a) the JSONB document persisted onto bng.projects.project.baseline (attribute
 * data only, no geometry), and (b) the parallel geometry rows for the four
 * bng.baseline_* PostGIS tables.
 *
 * Each feature is given a fresh UUID `featureId` that appears in both halves;
 * it is the join key between the JSONB document and the geometry tables.
 *
 * @param {object} layers
 * @param {object[]} layers.redline
 * @param {object[]} layers.areas
 * @param {object[]} layers.hedgerows
 * @param {object[]} layers.watercourses
 * @param {object} [meta]
 * @param {string} [meta.uploadId]
 * @param {string} [meta.filename]
 * @param {number} [meta.fileSize]
 * @param {string} [meta.importedAt] ISO timestamp; defaults to now
 * @param {object} [meta.habitatSizes] pre-calculated habitat sizes from calculateHabitatSizes
 * @returns {{
 *   document: object,
 *   geometries: {
 *     redLine: object|null,
 *     habitats: object[],
 *     hedgerows: object[],
 *     watercourses: object[]
 *   }
 * }}
 */
export function extractHabitatData(layers, meta = {}) {
  // `meta.variant` selects which attribute columns to read: the baseline
  // document reads the Baseline* columns, the post-intervention document reads
  // the Proposed* columns. Shared columns (ref, retention, metadata) are read
  // the same way for both.
  const keys = featureKeysForVariant(meta.variant)
  const redLine = buildRedLine(layers.redline)
  const habitats = splitFeatures(layers.areas ?? [], buildHabitat, keys)
  const hedgerows = splitFeatures(layers.hedgerows ?? [], buildHedgerow, keys)
  const watercourses = splitFeatures(
    layers.watercourses ?? [],
    buildWatercourse,
    keys
  )
  const trees = splitFeatures(layers.trees ?? [], buildTree, keys)

  // Embed the PostGIS-calculated size directly onto each feature document so
  // consumers (e.g. the frontend) can read habitat.sizeSquareMetres without a
  // secondary join. featureId is the join key between the sizes result and the documents.
  let habitatSizesSummary = null
  if (meta.habitatSizes) {
    habitatSizesSummary = embedHabitatSizes(
      habitats,
      hedgerows,
      watercourses,
      trees,
      meta.habitatSizes
    )
  }

  return {
    document: {
      uploadId: meta.uploadId ?? null,
      filename: meta.filename ?? null,
      fileSize: meta.fileSize ?? null,
      importedAt: meta.importedAt ?? new Date().toISOString(),
      redLine: redLine.document,
      habitats: habitats.documents,
      hedgerows: hedgerows.documents,
      watercourses: watercourses.documents,
      trees: trees.documents,
      habitatSizes: habitatSizesSummary
    },
    geometries: {
      redLine: redLine.geometryRow,
      habitats: habitats.geometries,
      hedgerows: hedgerows.geometries,
      watercourses: watercourses.geometries,
      trees: trees.geometries
    }
  }
}
