import { waitForUploadReady } from '../cdp-uploader/cdp-uploader.js'
import { downloadFile } from '../s3/download-file.js'
import { runParseInWorker } from './run-parse-in-worker.js'
import { createResponseCollector } from './response-collector.js'
import { validationConfigFor } from './validation-configs.js'
import {
  respondToGateRejection,
  validateLayersAndSave
} from '../upload/validate-layers-and-save.js'
import { createLogger } from '../../common/helpers/logging/logger.js'
import { metricsByteSize } from '../../common/helpers/metrics.js'
import { GEOPACKAGE_METRIC } from '../../common/helpers/metric-names.js'

const logger = createLogger()

/**
 * Run one validation job to completion.
 *
 * The same pipeline the synchronous route runs, with one difference that is
 * the whole point of this story: the parse happens on a worker thread, so the
 * request loop stays free while it runs.
 *
 * A returned value means the job reached an answer — including "the file is
 * invalid", which is a successful job with a rejection payload. A thrown error
 * means the job did not finish and should be retried.
 *
 * @param {{ drizzle: object, pgPool: import('pg').Pool }} deps
 * @param {{ id, uploadId, projectId, documentKey, credentials }} job
 * @returns {Promise<{ statusCode: number, payload: unknown }>}
 */
async function runValidationJob(deps, job) {
  const config = validationConfigFor(job.documentKey)
  const { bucket, key, filename, fileSize } = await waitForUploadReady(
    job.uploadId
  )
  if (fileSize != null) {
    await metricsByteSize(GEOPACKAGE_METRIC.uploadSizeBytes, fileSize)
  }

  const buffer = await downloadFile(bucket, key)
  const { toolkit, captured } = createResponseCollector()

  // The one line this whole story exists for: off the request loop.
  const gateResult = await runParseInWorker(buffer)

  if (!gateResult.valid) {
    await respondToGateRejection(gateResult, job.uploadId, toolkit, config)
    return captured
  }

  await validateLayersAndSave(
    gateResult.layers,
    deps.drizzle,
    deps.pgPool,
    {
      uploadId: job.uploadId,
      projectId: job.projectId,
      credentials: job.credentials,
      filename: filename ?? job.filename,
      fileSize: fileSize ?? job.fileSize
    },
    toolkit,
    config
  )

  logger.info(
    `${config.routeName} - job ${job.id} finished for uploadId ${job.uploadId} with status ${captured.statusCode}`
  )
  return captured
}

export { runValidationJob }
