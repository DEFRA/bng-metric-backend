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

/**
 * Durations and magnitudes for the upload pipeline, promoted from the
 * perf-evidence LOG lines to EMF metrics so they land in CloudWatch Metrics and
 * can be charted, compared across deploys and alerted on in Grafana. The log
 * lines remain the investigation surface; these are the dashboard surface.
 *
 * The split matters because CloudWatch bills per unique metric name x dimension
 * combination. Anything high-cardinality — uploadId, projectId, client IP,
 * table name — stays in the log line and MUST NOT become a dimension here. The
 * only dimension these carry is `documentKey`, which has exactly two values.
 *
 * Emitted once per request stage, never per feature: each call is a separate
 * EMF flush (see withMetrics in metrics.js).
 */
export const PERFORMANCE_METRIC = {
  /** Opening the GeoPackage and decoding every feature — synchronous, blocking. */
  parseMs: 'UploadParseMs',
  /** The single large PostGIS geometry-validation statement. */
  postgisValidateMs: 'UploadPostgisValidateMs',
  /** The separate PostGIS round trip that sizes each habitat. */
  sizingMs: 'UploadSizingMs',
  /** Document extract + engine enrichment, inline on the request handler. */
  enrichMs: 'UploadEnrichMs',
  /** The persist transaction: geometry inserts plus the document update. */
  persistMs: 'UploadPersistMs',
  /** Whole validate-and-save handler, end to end. */
  totalMs: 'UploadTotalMs',
  /** Features carried through the pipeline — the scale behind every duration. */
  featureCount: 'UploadFeatureCount'
}

/**
 * Values for the `documentKey` dimension on the PERFORMANCE_METRIC family.
 * Deliberately the only dimension: two values, so the metric count stays bounded.
 */
export const DOCUMENT_KEY_DIMENSION = {
  baseline: 'baseline',
  postIntervention: 'postIntervention'
}
