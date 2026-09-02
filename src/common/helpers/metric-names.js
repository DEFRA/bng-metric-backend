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
   * Uploads refused with a 503 because the validator was saturated. Not a
   * validation failure — the file was never looked at — which is why it is
   * counted apart from `validationFailed`.
   *
   * This is the capacity signal, sliced by a three-valued `reason` because the
   * three ways of being refused have different remedies. See
   * {@link VALIDATION_BUSY_REASON}.
   */
  validationBusy: 'GeoPackageValidationBusy'
}

/**
 * Values for the `reason` dimension on GeoPackageValidationBusy. Three ways to
 * be told "not now", and they are not interchangeable:
 *
 *   no_capacity  The route refused before doing any work, because the pool was
 *                already full. The cheap, expected case under load.
 *   queue_full   The pool refused at the point of running. Same meaning as
 *                above, reached through a race — the capacity check is advisory.
 *   queue_wait   A job sat in the queue longer than it was worth starting. This
 *                one says jobs are slow, not that arrivals are many, so the
 *                remedy is different: look at file sizes before adding workers.
 */
export const VALIDATION_BUSY_REASON = Object.freeze({
  noCapacity: 'no_capacity',
  queueFull: 'queue_full',
  queueWait: 'queue_wait'
})

/**
 * Health of the geometry-validation worker pool.
 *
 * These are the leading indicators. `GeoPackageValidationBusy` only moves once
 * users are already being turned away; queue depth and wait time start climbing
 * well before that, and the memory figure is the one that decides whether adding
 * workers is even an option.
 */
export const VALIDATION_METRIC = {
  /** Validations waiting for a free worker, sampled as each one is served. */
  workerQueueDepth: 'ValidationWorkerQueueDepth',
  /**
   * Workers replaced after dying — a crash, or the WebAssembly heap running out.
   * Should be flat at zero. A rising rate alongside memory is the OOM signature.
   */
  workerRestarts: 'ValidationWorkerRestarts',
  /** Validations killed for overrunning VALIDATION_WORKER_TIMEOUT_MS. */
  workerTimeouts: 'ValidationWorkerTimeouts',
  /**
   * Whole-process resident memory, sampled after each validation.
   *
   * Process-wide on purpose: worker threads share this process, their
   * WebAssembly heaps grow to the largest file each has ever seen and are never
   * returned, and it is the TOTAL that has to fit the ECS task limit. This is
   * the telemetry for the one question the rollout still has open — whether the
   * task can hold the workers it is configured for.
   */
  processResidentMb: 'BackendProcessResidentMb'
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
  /**
   * Time a validation spent waiting for a free worker, before any geometry work
   * began. Separated from geometryValidateMs because the two have opposite
   * remedies: waiting means too few workers, working means too much geometry.
   */
  queueWaitMs: 'UploadValidationQueueWaitMs',
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
