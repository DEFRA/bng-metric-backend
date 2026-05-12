import { ERROR_CODES, makeError } from './errors.js'
import {
  formatSrsIdForError,
  integerSrsCodeOrNull
} from './geopackage-internals-sqlite.js'

function pushNeitherTableParsesIntegerSrs(
  layerDef,
  actualTable,
  contentMeta,
  geomRow,
  errors
) {
  errors.push(
    makeError(
      ERROR_CODES.GPKG_BASELINE_SRS_ID,
      `Layer "${actualTable}" baseline mismatch: expected srs_id ${layerDef.srsId} but could not read a valid integer srs_id from gpkg_contents (${formatSrsIdForError(contentMeta?.srs_id)}) nor gpkg_geometry_columns (${formatSrsIdForError(geomRow.geom_srs_raw)})`
    )
  )
}

function pushGpkgInternalSrsMismatch(
  actualTable,
  contentMeta,
  geomRow,
  errors
) {
  errors.push(
    makeError(
      ERROR_CODES.GPKG_BASELINE_GPKG_SRS_INCONSISTENT,
      `Layer "${actualTable}" GeoPackage srs_id inconsistent: gpkg_contents has ${formatSrsIdForError(contentMeta?.srs_id)} but gpkg_geometry_columns has ${formatSrsIdForError(geomRow.geom_srs_raw)}`
    )
  )
}

function pushExpectedSrsIdMismatch(layerDef, actualTable, unified, errors) {
  errors.push(
    makeError(
      ERROR_CODES.GPKG_BASELINE_SRS_ID,
      `Layer "${actualTable}" baseline mismatch: expected srs_id ${layerDef.srsId} but GeoPackage srs_id is ${unified}`
    )
  )
}

function compareBaselineLayerSrsWhenGeomMissing(
  layerDef,
  actualTable,
  contentMeta,
  errors
) {
  const expectedCrs = Number(layerDef.srsId)
  const contentsSrsWhenNoGeomColumns = integerSrsCodeOrNull(contentMeta?.srs_id)
  const matchesExpectedWithoutGeomRegistration =
    Number.isInteger(expectedCrs) &&
    contentsSrsWhenNoGeomColumns !== null &&
    expectedCrs === contentsSrsWhenNoGeomColumns
  if (matchesExpectedWithoutGeomRegistration) {
    return
  }
  errors.push(
    makeError(
      ERROR_CODES.GPKG_BASELINE_SRS_ID,
      `Layer "${actualTable}" baseline mismatch: expected srs_id ${layerDef.srsId} but gpkg_contents has ${formatSrsIdForError(contentMeta?.srs_id)}`
    )
  )
}

function compareBaselineLayerSrsWhenGeomRegistered(
  layerDef,
  actualTable,
  contentMeta,
  geomRow,
  errors
) {
  const expectedCrs = Number(layerDef.srsId)
  const contentsSrsInt = integerSrsCodeOrNull(contentMeta?.srs_id)
  const geomSrsInt = integerSrsCodeOrNull(geomRow.geom_srs_raw)
  const contentsParses = contentsSrsInt !== null
  const geomParses = geomSrsInt !== null

  if (!contentsParses && !geomParses) {
    pushNeitherTableParsesIntegerSrs(
      layerDef,
      actualTable,
      contentMeta,
      geomRow,
      errors
    )
    return
  }

  const bothParseSameRow = contentsParses && geomParses
  const internalMismatch = !bothParseSameRow || contentsSrsInt !== geomSrsInt
  if (internalMismatch) {
    pushGpkgInternalSrsMismatch(actualTable, contentMeta, geomRow, errors)
    return
  }

  const unified = /** @type {number} */ (contentsSrsInt)
  if (unified !== expectedCrs) {
    pushExpectedSrsIdMismatch(layerDef, actualTable, unified, errors)
  }
}

/**
 * Single canonical srs_id validation: reconciles gpkg_contents and gpkg_geometry_columns before
 * comparing to the baseline (avoids paired duplicate SRS errors).
 *
 * @param {{ srsId: number|string }} layerDef
 * @param {string} actualTable
 * @param {{ srs_id?: unknown } | undefined} contentMeta
 * @param {{ geom_srs_raw: unknown } | null | undefined} geomRow
 * @param {string[]} errors
 */
export function compareBaselineLayerSrs(
  layerDef,
  actualTable,
  contentMeta,
  geomRow,
  errors
) {
  if (!geomRow) {
    compareBaselineLayerSrsWhenGeomMissing(
      layerDef,
      actualTable,
      contentMeta,
      errors
    )
    return
  }

  compareBaselineLayerSrsWhenGeomRegistered(
    layerDef,
    actualTable,
    contentMeta,
    geomRow,
    errors
  )
}
