/**
 * Helpers shared by the baseline (extract-habitat-data.js) and post-intervention
 * (extract-post-intervention.js) extract paths. Both shape an already-parsed
 * `layers` object into a JSONB document plus parallel geometry rows in the same
 * way; only the per-feature builders differ, so the size embedding and the final
 * document/geometry assembly live here to keep the two paths from drifting.
 */

import { PROP_KEYS, pickProp } from './properties.js'
import { summarizeTreeSizes } from './tree-sizes.js'
import { verticalAreaSquareMetres } from './vertical-area-check.js'

/**
 * Map parsed GeoPackage features into parallel document and geometry arrays.
 *
 * @param {object[]} features
 * @param {(feature: object, ...builderArgs: unknown[]) => { document: object, geometryRow: object }} builder
 * @param {...unknown} builderArgs
 * @returns {{ documents: object[], geometries: object[] }}
 */
export function splitFeatures(features, builder, ...builderArgs) {
  const documents = []
  const geometries = []
  for (const feature of features) {
    const { document, geometryRow } = builder(feature, ...builderArgs)
    documents.push(document)
    geometries.push(geometryRow)
  }
  return { documents, geometries }
}

/**
 * @param {number | null | undefined} sizeSquareMetres
 * @returns {number | null}
 */
export function areaFromSizeSquareMetres(sizeSquareMetres) {
  if (
    typeof sizeSquareMetres !== 'number' ||
    !Number.isFinite(sizeSquareMetres)
  ) {
    return null
  }
  return Math.round(sizeSquareMetres)
}

/**
 * A vertical area habitat's size: the Area the surveyor typed in, in square
 * metres, as the face area they estimated on site. A line cannot give it, so
 * it is not measured. Null when it is not a number above 0, which the upload
 * checks refuse (vertical-area-check.js).
 *
 * @param {object} properties the row's GeoPackage properties
 * @returns {{ sizeSquareMetres: number | null, area: number | null }}
 */
export function verticalAreaFields(properties) {
  const sizeSquareMetres = verticalAreaSquareMetres(
    pickProp(properties ?? {}, PROP_KEYS.area)
  )
  return {
    sizeSquareMetres,
    area: areaFromSizeSquareMetres(sizeSquareMetres)
  }
}

/**
 * The total typed area of the vertical area habitats, in square metres.
 *
 * @param {object[]} verticalDocuments
 * @returns {{ totalSquareMetres: number }}
 */
export function summarizeVerticalHabitatSizes(verticalDocuments) {
  let totalSquareMetres = 0
  for (const vertical of verticalDocuments) {
    if (Number.isFinite(vertical.sizeSquareMetres)) {
      totalSquareMetres += vertical.sizeSquareMetres
    }
  }
  return { totalSquareMetres }
}

/**
 * Embed the measured parcel sizes onto each area-habitat document.
 * featureId is the join key between the sizes result and the documents.
 *
 * @param {object[]} habitatDocuments
 * @param {{ individualSquareMetres: Array<{ featureId: string, sizeSquareMetres: number }> }} areaHabitats
 */
export function embedParcelSizes(habitatDocuments, areaHabitats) {
  const areaSizesByFeatureId = new Map(
    areaHabitats.individualSquareMetres.map((entry) => [
      entry.featureId,
      entry.sizeSquareMetres
    ])
  )
  for (const document of habitatDocuments) {
    const sizeSquareMetres =
      areaSizesByFeatureId.get(document.featureId) ?? null
    document.sizeSquareMetres = sizeSquareMetres
    document.area = areaFromSizeSquareMetres(sizeSquareMetres)
  }
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
 * Post-intervention linear documents also persist a rounded display length.
 *
 * @param {object[]} documents
 * @param {Array<{ featureId: string, sizeMetres: number }>} sizeEntries
 */
function embedRoundedLinearFeatureSizes(documents, sizeEntries) {
  embedLinearFeatureSizes(documents, sizeEntries)
  for (const document of documents) {
    document.length =
      typeof document.sizeMetres === 'number'
        ? Math.round(document.sizeMetres)
        : null
  }
}

/**
 * Build the persisted habitat-size summary from the measured parcel/linear totals
 * plus the notional tree sizes and the typed vertical area habitat sizes. Trees
 * and vertical area habitats are special area habitats: their area is summed
 * into the headline `areaHabitats` total but excluded from `site` (the figure
 * compared against the red line boundary), as the Metric leaves "individual
 * trees, green walls, intertidal hard structures" out of the site area.
 *
 * @param {{ areaHabitats: { totalSquareMetres: number }, hedgerows: { totalMetres: number }, watercourses: { totalMetres: number } }} habitatSizes
 * @param {{ totalSquareMetres: number, urbanSquareMetres: number, ruralSquareMetres: number }} treeSizes
 * @param {{ totalSquareMetres: number }} [verticalSizes] absent for a legacy
 *   file, which has no vertical area habitats
 * @returns {object}
 */
export function buildHabitatSizesSummary(
  habitatSizes,
  treeSizes,
  verticalSizes = { totalSquareMetres: 0 }
) {
  const { areaHabitats, hedgerows, watercourses } = habitatSizes
  return {
    areaHabitats: {
      totalSquareMetres:
        areaHabitats.totalSquareMetres +
        treeSizes.totalSquareMetres +
        verticalSizes.totalSquareMetres
    },
    hedgerows: { totalMetres: hedgerows.totalMetres },
    watercourses: { totalMetres: watercourses.totalMetres },
    trees: treeSizes,
    verticalHabitats: verticalSizes,
    site: { totalSquareMetres: areaHabitats.totalSquareMetres }
  }
}

/**
 * @param {{ habitats: object, hedgerows: object, watercourses: object, trees: object, verticalHabitats?: object }} parts
 * @param {object} habitatSizes
 * @param {(tree: object) => string | null | undefined} getTreeType
 * @param {(documents: object[], sizeEntries: object[]) => void} embedLinearSizes
 * @returns {object}
 */
function embedHabitatSizes(parts, habitatSizes, getTreeType, embedLinearSizes) {
  const { habitats, hedgerows, watercourses, trees, verticalHabitats } = parts
  embedParcelSizes(habitats.documents, habitatSizes.areaHabitats)
  embedLinearSizes(hedgerows.documents, habitatSizes.hedgerows.individualMetres)
  embedLinearSizes(
    watercourses.documents,
    habitatSizes.watercourses.individualMetres
  )
  const treeSizes = summarizeTreeSizes(trees.documents, getTreeType)
  return buildHabitatSizesSummary(
    habitatSizes,
    treeSizes,
    summarizeVerticalHabitatSizes(verticalHabitats?.documents ?? [])
  )
}

/**
 * @param {{ habitats: object, hedgerows: object, watercourses: object, trees: object, verticalHabitats?: object }} parts
 * @param {object} habitatSizes
 * @returns {object}
 */
export function embedBaselineHabitatSizes(parts, habitatSizes) {
  return embedHabitatSizes(
    parts,
    habitatSizes,
    (tree) => tree.type,
    embedLinearFeatureSizes
  )
}

/**
 * @param {{ habitats: object, hedgerows: object, watercourses: object, trees: object, verticalHabitats?: object }} parts
 * @param {object} habitatSizes
 * @returns {object}
 */
export function embedPostInterventionHabitatSizes(parts, habitatSizes) {
  return embedHabitatSizes(
    parts,
    habitatSizes,
    (tree) => tree.proposed?.type,
    embedRoundedLinearFeatureSizes
  )
}

/**
 * Assemble the `{ document, geometries }` result shared by both extract paths.
 *
 * @param {object} meta upload metadata (uploadId/filename/fileSize/importedAt,
 *   and template for a BNG Service template file)
 * @param {{ redLine: object, habitats: object, hedgerows: object, watercourses: object, trees: object, verticalHabitats?: object }} parts
 *   each `*.documents` / `*.geometries` pair from splitFeatures (redLine is `{ document, geometryRow }`)
 * @param {object | null} habitatSizesSummary
 * @returns {{ document: object, geometries: object }}
 */
export function buildExtractResult(meta, parts, habitatSizesSummary) {
  const { redLine, habitats, hedgerows, watercourses, trees } = parts
  const verticalHabitats = parts.verticalHabitats ?? {
    documents: [],
    geometries: []
  }
  return {
    document: {
      uploadId: meta.uploadId ?? null,
      filename: meta.filename ?? null,
      fileSize: meta.fileSize ?? null,
      importedAt: meta.importedAt ?? new Date().toISOString(),
      // A BNG Service template file names its template and version; a
      // legacy file has neither, so its documents carry no `template`.
      ...(meta.template && { template: meta.template }),
      redLine: redLine.document,
      habitats: habitats.documents,
      hedgerows: hedgerows.documents,
      watercourses: watercourses.documents,
      trees: trees.documents,
      verticalHabitats: verticalHabitats.documents,
      habitatSizes: habitatSizesSummary
    },
    geometries: {
      redLine: redLine.geometryRow,
      habitats: habitats.geometries,
      hedgerows: hedgerows.geometries,
      watercourses: watercourses.geometries,
      trees: trees.geometries,
      verticalHabitats: verticalHabitats.geometries
    }
  }
}
