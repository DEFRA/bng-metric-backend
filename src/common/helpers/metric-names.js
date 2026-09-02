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
  uploadSizeBytes: 'GeoPackageUploadSizeBytes',
  /**
   * Uploads refused with a 503 because every validation worker was busy and the
   * queue was full. Not a validation failure — the file was never looked at —
   * which is why it is counted apart from `validationFailed`.
   *
   * This is the capacity signal. A non-zero rate means the worker pool is
   * undersized for the traffic, and the levers are VALIDATION_WORKER_COUNT (if
   * the task has the memory) or more backend instances.
   */
  validationBusy: 'GeoPackageValidationBusy'
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
  /**
   * The geometry-validation stage.
   *
   * The EMITTED NAME still says Postgis, and that is deliberate. The stage no
   * longer runs in PostGIS — it runs on a worker thread — but keeping the name
   * keeps the Grafana history continuous across the switch, which is exactly the
   * comparison anyone watching this rollout wants to make. Rename it in a
   * follow-up once the dashboards have been repointed, not before.
   */
  geometryValidateMs: 'UploadPostgisValidateMs',
  /**
   * The habitat-sizing stage. Now a pure map over measurements the validation
   * worker already made, rather than the second PostGIS round trip it used to
   * be — kept so the drop is visible on the dashboard rather than vanishing.
   */
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
