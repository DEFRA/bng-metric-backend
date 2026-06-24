/**
 * Helpers shared by the baseline (extract-habitat-data.js) and post-intervention
 * (extract-post-intervention.js) extract paths. Both shape an already-parsed
 * `layers` object into a JSONB document plus parallel geometry rows in the same
 * way; only the per-feature builders differ, so the size embedding and the final
 * document/geometry assembly live here to keep the two paths from drifting.
 */

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
 * Embed the PostGIS-measured parcel sizes onto each area-habitat document.
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
 * Build the persisted habitat-size summary from the PostGIS parcel/linear totals
 * plus the notional tree sizes. Trees are a special area habitat: their area is
 * summed into the headline `areaHabitats` total but excluded from `site` (the
 * figure compared against the red line boundary).
 *
 * @param {{ areaHabitats: { totalSquareMetres: number }, hedgerows: { totalMetres: number }, watercourses: { totalMetres: number } }} habitatSizes
 * @param {{ totalSquareMetres: number, urbanSquareMetres: number, ruralSquareMetres: number }} treeSizes
 * @returns {object}
 */
export function buildHabitatSizesSummary(habitatSizes, treeSizes) {
  const { areaHabitats, hedgerows, watercourses } = habitatSizes
  return {
    areaHabitats: {
      totalSquareMetres:
        areaHabitats.totalSquareMetres + treeSizes.totalSquareMetres
    },
    hedgerows: { totalMetres: hedgerows.totalMetres },
    watercourses: { totalMetres: watercourses.totalMetres },
    trees: treeSizes,
    site: { totalSquareMetres: areaHabitats.totalSquareMetres }
  }
}

/**
 * Assemble the `{ document, geometries }` result shared by both extract paths.
 *
 * @param {object} meta upload metadata (uploadId/filename/fileSize/importedAt)
 * @param {{ redLine: object, habitats: object, hedgerows: object, watercourses: object, trees: object }} parts
 *   each `*.documents` / `*.geometries` pair from splitFeatures (redLine is `{ document, geometryRow }`)
 * @param {object | null} habitatSizesSummary
 * @returns {{ document: object, geometries: object }}
 */
export function buildExtractResult(meta, parts, habitatSizesSummary) {
  const { redLine, habitats, hedgerows, watercourses, trees } = parts
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
