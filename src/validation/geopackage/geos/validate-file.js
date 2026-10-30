/**
 * The geometry checks for one GeoPackage file: what a GEOS worker does for
 * each job, as a plain function, so the same checks run with or without the
 * pool (see `inThread` on validateGeoPackageLayers).
 *
 * Run on the main thread, this holds the event loop for the whole file, so
 * the upload route always goes through the pool (worker.js explains why).
 */
import { readGeoPackage } from '../geopackage.js'
import { FEATURE_READ_MODE } from '../read-feature-tables.js'
import { validateGeoPackageLayersGeos } from './index.js'
import {
  lineageErrorsFor,
  withLineageErrors
} from '../service-template/lineage-stage.js'

/**
 * @param {string} filePath the GeoPackage, on local disk
 * @param {object} [options]
 * @param {boolean} [options.includeSizes] also return per-feature sizes
 * @param {import('../service-template/template-tables.js').TemplateReadSource} [options.source]
 *   how to read a BNG Service template file; omitted for a legacy one
 * @param {import('../service-template/template-tables.js').TemplateReadSource} [options.lineageSource]
 *   the Baseline tables whose parent links are checked too (BMD-1083)
 * @returns {Promise<object>} the verdict from validateGeoPackageLayersGeos,
 *   with any lineage errors
 */
export async function validateGeoPackageFileGeos(
  filePath,
  { includeSizes = false, source, lineageSource } = {}
) {
  const layers = readGeoPackage(filePath, FEATURE_READ_MODE.full, source)
  const result = await validateGeoPackageLayersGeos(layers, { includeSizes })
  // A BNG Service template file's parent links, checked against these
  // Post-Intervention rows (BMD-1083); none for any other upload.
  const lineageErrors = lineageErrorsFor(filePath, layers, lineageSource)
  return withLineageErrors(result, lineageErrors)
}
