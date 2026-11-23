import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeMetricWorkbook } from 'bng-library/workbook-writer'

import { metricRowsFromProject } from './project-rows.js'

/**
 * A project as a filled-in copy of the Statutory Biodiversity Metric
 * (BMD-1141), in either of the two forms Defra publishes it: the
 * macro-enabled workbook or the macro-free one, both release 1.1.1, kept in
 * ./templates exactly as GOV.UK serves them.
 *
 * Each download writes into a fresh copy of the template's bytes; the
 * template itself is never changed. Only input cells are written: the
 * metric's formulas, macros and sheet protection are left as Defra published
 * them (no corrections), and Excel is told to recalculate everything when the
 * file is opened, so the results it shows are the metric's own.
 */

const TEMPLATES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'templates'
)

export const METRIC_RELEASE = '1.1.1'

export const METRIC_FORMATS = Object.freeze({
  xlsm: Object.freeze({
    fileName: 'The_Statutory_Metric_Macro_Enabled_1.1.1.xlsm',
    contentType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    sha256: 'dae2d78daceba3a01b3fddf47c4990b59252665b86c76edf078e37725d23fedc'
  }),
  xlsx: Object.freeze({
    fileName: 'The_Statutory_Metric_Macro_Disabled_1.1.1.xlsx',
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sha256: '2ee1413bf5fb81537867d01de96c94e37be8f00d6d95da47f56656fedd1415a2'
  })
})

// Each template is read once and kept: a download copies it in memory, and
// the writer never changes the buffer it is given.
const templateReads = new Map()

/**
 * @param {keyof typeof METRIC_FORMATS} format
 * @returns {Promise<Buffer>}
 */
export function metricTemplate(format) {
  if (!templateReads.has(format)) {
    const read = readFile(
      path.join(TEMPLATES_DIR, METRIC_FORMATS[format].fileName)
    )
    // A failed read is not kept, so the next download tries again.
    read.catch(() => templateReads.delete(format))
    templateReads.set(format, read)
  }
  return templateReads.get(format)
}

/**
 * The Start sheet's project details. "Completed by" is left for the user:
 * the service does not know who completed the metric.
 *
 * @param {object} project the project document
 * @param {Date} now when the download is made
 */
function projectDetails(project, now) {
  const details = project.details ?? {}
  return {
    planningAuthority: details.localPlanningAuthority ?? null,
    projectName: project.name ?? null,
    applicant: details.applicant ?? null,
    applicationType: details.planningApplicationType ?? null,
    planningApplicationReference: details.planningApplicationReference ?? null,
    completionDate: now
  }
}

/**
 * @param {object} project the project document, as stored in
 *   `projects.project`
 * @param {object} options
 * @param {keyof typeof METRIC_FORMATS} options.format
 * @param {Date} [options.now] the date of the download, written as the date
 *   of metric completion
 * @returns {Promise<Buffer>} the workbook's bytes
 */
export async function buildMetricWorkbook(
  project,
  { format, now = new Date() }
) {
  if (!Object.hasOwn(METRIC_FORMATS, format)) {
    throw new Error(`Unknown metric format: ${format}`)
  }
  return writeMetricWorkbook({
    templateBuffer: await metricTemplate(format),
    rows: metricRowsFromProject(project),
    corrections: [],
    details: projectDetails(project, now)
  })
}
