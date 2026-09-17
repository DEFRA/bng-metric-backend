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
 *
 * The geometry read is capped per layer, so a very large project arrives here
 * partially. Each side carries a `capped` list saying which layers that
 * happened to and how much of each is shown, and the document prints it — see
 * `cappedLayers` below and `summary-page.js`.
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
    ...identity(feature, proposed),
    ...scores(feature, proposed),
    ...sizes(feature),
    ...intervention(feature, proposed),
    ...recorded(feature)
  }
}

/**
 * The proposed value where the parcel has one, the baseline's otherwise.
 *
 * One accessor rather than the same `proposed.x ?? feature.x ?? null` written
 * out twelve times: the fallback is a single rule about how the
 * post-intervention document nests values, and it should be stated once and
 * be impossible to get subtly wrong on the thirteenth field.
 */
function proposedOr(feature, proposed, key) {
  return proposed[key] ?? feature[key] ?? null
}

/** What the parcel is, and what it is worth. */
function identity(feature, proposed) {
  const value = (key) => proposedOr(feature, proposed, key)
  return {
    ref: feature.ref ?? null,
    type: value('type'),
    broadType: value('broadType'),
    condition: value('condition'),
    // Set by the enrichment step from the metric engine, so absent on a project
    // that has not been calculated yet. The report shows what is there and says
    // nothing about what is not — see habitat-cards.js.
    distinctiveness: value('distinctiveness'),
    strategicSignificance: value('strategicSignificance'),
    retentionCategory: value('retentionCategory'),
    units: numberOrNull(value('units'))
  }
}

/**
 * The scores behind the bands. The service shows these as "Low (2)" rather
 * than on a line of their own, and the report follows it.
 */
function scores(feature, proposed) {
  const value = (key) => proposedOr(feature, proposed, key)
  return {
    distinctivenessScore: numberOrNull(value('distinctivenessScore')),
    conditionScore: numberOrNull(value('conditionScore'))
  }
}

/**
 * Size is never taken from `proposed`: a parcel's area or length is a fact
 * about the ground, not something an intervention proposes.
 */
function sizes(feature) {
  return {
    sizeSquareMetres: numberOrNull(feature.sizeSquareMetres),
    sizeMetres: numberOrNull(feature.sizeMetres)
  }
}

/**
 * Post-intervention only: how the parcel's number was arrived at. Absent on a
 * baseline feature, which is why every one of them is optional on a card.
 */
function intervention(feature, proposed) {
  const value = (key) => proposedOr(feature, proposed, key)
  return {
    difficulty: value('difficulty'),
    difficultyMultiplier: numberOrNull(value('difficultyMultiplier')),
    standardTimeToTargetCondition: value('standardTimeToTargetCondition'),
    finalTimeToTargetCondition: value('finalTimeToTargetCondition'),
    advanceOrDelay: value('advanceOrDelay')
  }
}

/** Recorded against the parcel in the GeoPackage rather than calculated. */
function recorded(feature) {
  return {
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
    layers,
    documentCounts: documentCounts(document),
    capped: cappedLayers(document, geometry, layers)
  }
}

/**
 * How many features of each layer the project HOLDS, as distinct from how
 * many this report drew.
 *
 * The two differ where a feature has no geometry to join to, and where a
 * layer was capped. The summary tiles want the first number — they decide
 * whether a project has hedgerows at all, and the answer must not change
 * because a hedgerow was dropped from a map — and the capped note wants it as
 * its denominator.
 */
function documentCounts(document) {
  return Object.fromEntries(
    GEOMETRY_LAYERS.map((layer) => [layer, document[layer]?.length ?? 0])
  )
}

/**
 * The layers this side is showing only part of.
 *
 * `readProjectGeometry` caps each layer's read (see `report.maxFeaturesPerLayer`)
 * so one enormous project cannot cost the process an unbounded amount of
 * memory. A capped layer must be declared, not quietly shortened: a site map
 * missing a third of its parcels looks like a complete map of a smaller site.
 *
 * The denominator comes from the document, which lists every feature the
 * project holds and is a row this request has already read — so saying "500 of
 * 1,240" costs nothing, where counting the rows PostGIS was told not to return
 * would cost a second query per layer.
 */
function cappedLayers(document, geometry, layers) {
  return (geometry.cappedLayers ?? []).map((layer) => ({
    layer,
    shown: layers[layer].length,
    total: document[layer]?.length ?? null
  }))
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

export {
  attributesOf,
  buildSite,
  cappedLayers,
  documentCounts,
  joinLayer,
  readSiteData
}
