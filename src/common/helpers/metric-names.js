/**
 * Catalogue of the custom CloudWatch (EMF) metrics this service emits.
 *
 * Kept deliberately small and high-signal: validation failures are a single
 * counter sliced by a low-cardinality `category` dimension rather than a metric
 * name per category, so Grafana dashboards stay flexible without metric sprawl.
 */
export const GEOPACKAGE_METRIC = {
  validationSucceeded: 'GeoPackageValidationSucceeded',
  validationFailed: 'GeoPackageValidationFailed',
  uploadSizeBytes: 'GeoPackageUploadSizeBytes'
}

/**
 * Values for the `category` dimension on GeoPackageValidationFailed.
 */
export const VALIDATION_CATEGORY = {
  virus: 'virus',
  internalData: 'internal_data',
  geometric: 'geometric'
}
