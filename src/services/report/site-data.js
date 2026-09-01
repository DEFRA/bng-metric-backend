/**
 * Assembling what the report draws: the project document for the numbers, and
 * PostGIS for the shapes.
 *
 * The split is deliberate.
 *
 *  - **Attributes come from the document.** `sizeSquareMetres`, habitat type
 *    and condition are what the service shows on screen and what the unit
 *    calculation ran on. Recomputing any of them from the geometry would give
 *    the report a second opinion, and a report that disagrees with the page it
 *    was generated from is worse than no report.
 *  - **Shapes come from the geometry tables**, which are the copy the user has
 *    since edited. See `db/project-geometry.js`.
 *
 * They are matched by `featureId`, which is the geometry row's primary key.
 * A feature present in one and not the other is dropped rather than guessed
 * at: drawing a parcel with no attributes, or listing attributes with no
 * parcel, would both be a silent misrepresentation of the site.
 */

import {
  GEOMETRY_LAYERS,
  readProjectGeometry
} from '../../db/project-geometry.js'

/**
 * The post-intervention document nests the values a parcel will have after the
 * work under `proposed`, keeping the baseline values alongside. The report
 * shows what the parcel is proposed to become, falling back to the top-level
 * spelling so a baseline feature reads through the same accessor.
 */
function attributesOf(feature) {
  const proposed = feature.proposed ?? {}
  return {
    ref: feature.ref ?? null,
    type: proposed.type ?? feature.type ?? null,
    broadType: proposed.broadType ?? feature.broadType ?? null,
    condition: proposed.condition ?? feature.condition ?? null,
    // Set by the enrichment step from the metric engine, so absent on a project
    // that has not been calculated yet. The report shows what is there and says
    // nothing about what is not — see habitat-cards.js.
    distinctiveness:
      proposed.distinctiveness ?? feature.distinctiveness ?? null,
    strategicSignificance:
      proposed.strategicSignificance ?? feature.strategicSignificance ?? null,
    retentionCategory:
      proposed.retentionCategory ?? feature.retentionCategory ?? null,
    units: numberOrNull(proposed.units ?? feature.units),
    sizeSquareMetres: numberOrNull(feature.sizeSquareMetres),
    sizeMetres: numberOrNull(feature.sizeMetres),

    // The scores behind the bands. The service shows these as "Low (2)" rather
    // than on a line of their own, and the report follows it.
    distinctivenessScore: numberOrNull(
      proposed.distinctivenessScore ?? feature.distinctivenessScore
    ),
    conditionScore: numberOrNull(
      proposed.conditionScore ?? feature.conditionScore
    ),

    // Post-intervention only: how the parcel's number was arrived at. Absent on
    // a baseline feature, which is why every one of them is optional on a card.
    difficulty: proposed.difficulty ?? feature.difficulty ?? null,
    difficultyMultiplier: numberOrNull(
      proposed.difficultyMultiplier ?? feature.difficultyMultiplier
    ),
    standardTimeToTargetCondition:
      proposed.standardTimeToTargetCondition ??
      feature.standardTimeToTargetCondition ??
      null,
    finalTimeToTargetCondition:
      proposed.finalTimeToTargetCondition ??
      feature.finalTimeToTargetCondition ??
      null,
    advanceOrDelay: proposed.advanceOrDelay ?? feature.advanceOrDelay ?? null,

    // Recorded against the parcel in the GeoPackage rather than calculated.
    spatialRiskCategory: feature.spatialRiskCategory ?? null,
    status: feature.status ?? null,
    surveyDate: feature.surveyDate ?? null,
    surveyDetails: feature.surveyDetails ?? null,
    comment: feature.comment ?? null
  }
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null
}

/**
 * Join one layer's document features to their geometry.
 *
 * Document order is preserved: it is the order the habitat list screens use,
 * so the report's rows and the screen's rows read the same way down the page.
 */
function joinLayer(documentFeatures, geometryFeatures) {
  const geometryById = new Map(
    geometryFeatures.map((feature) => [feature.featureId, feature.geometry])
  )

  const joined = []
  for (const feature of documentFeatures ?? []) {
    const geometry = geometryById.get(feature.featureId)
    if (geometry) {
      joined.push({ properties: attributesOf(feature), geometry })
    }
  }
  return joined
}

/**
 * Build one side of the report — baseline or post-intervention.
 *
 * Returns null when the document has no such side, which is the normal state
 * of a project that has uploaded a baseline and nothing else.
 *
 * @param {object} document        the project JSONB
 * @param {object} geometry        readProjectGeometry() output
 * @param {string} siteName
 */
function buildSite(document, geometry, siteName) {
  if (!document) {
    return null
  }

  const layers = {}
  for (const layer of GEOMETRY_LAYERS) {
    layers[layer] = joinLayer(document[layer], geometry.layers[layer])
  }

  return {
    siteName,
    units: document.units ?? null,
    redLine: geometry.redLine,
    redLineAreaSqm: geometry.redLineAreaSqm,
    layers
  }
}

/**
 * Read everything one report needs.
 *
 * The two sides are read concurrently: they touch disjoint tables, and a site
 * with a post-intervention upload would otherwise pay twice the latency for no
 * reason.
 *
 * @param {object} drizzle
 * @param {{ id: string, project: object }} projectRow
 */
async function readSiteData(drizzle, projectRow) {
  const document = projectRow.project ?? {}
  const siteName = document.name ?? 'BNG site'

  const [baselineGeometry, postInterventionGeometry] = await Promise.all([
    readProjectGeometry(drizzle, projectRow.id, 'baseline'),
    document.postIntervention
      ? readProjectGeometry(drizzle, projectRow.id, 'postIntervention')
      : null
  ])

  return {
    siteName,
    baseline: buildSite(document.baseline, baselineGeometry, siteName),
    postIntervention: postInterventionGeometry
      ? buildSite(document.postIntervention, postInterventionGeometry, siteName)
      : null
  }
}

export { attributesOf, buildSite, joinLayer, readSiteData }
