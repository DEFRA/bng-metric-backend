// Run the metric comparison (BMD-1036): import every scenario in a folder
// through the service's own upload pipeline and compare what it computes with
// the Statutory Biodiversity Metric's answers for the same site.
//
// A scenario is a baseline and post-intervention GeoPackage beside the metric
// workbook describing the same site; the metric's answers are read from the
// workbook. The comparison itself lives in bng-library
// (`bng-library/metric-compare`); the committed scenarios, in the harness
// (find-scenario-corpus.js); the import is this service's. So a change to
// either side — the engine in the library, or the extraction and enrichment
// here — is measured against the metric by the same run.

import {
  compareScenario,
  figuresFromProject,
  figuresFromWorkbook,
  findScenarios,
  readWorkbookAnswers
} from 'bng-library/metric-compare'

import { CORPUS_DIR_ENV, findScenarioCorpus } from './find-scenario-corpus.js'
import { importGeoPackagePair } from './import-geopackage-pair.js'

/**
 * A scenario is selected by its id ("net-gain/met"), its name ("met") or its
 * purpose — the folder it is in ("net-gain"); no filter selects all.
 *
 * @param {{ id: string, name: string, purpose: string }} scenario
 * @param {string[]} only
 */
function isSelected(scenario, only) {
  return (
    only.length === 0 ||
    [scenario.id, scenario.name, scenario.purpose].some((key) =>
      only.includes(key)
    )
  )
}

/**
 * @param {import('bng-library/metric-compare').CorpusScenario} scenario
 * @param {{ results?: object, error?: string }} answers the metric workbook's
 *   answers, from readWorkbookAnswers
 */
export async function compareCorpusScenario(scenario, answers) {
  if (answers.error) {
    return compareScenario({ scenario, workbookError: answers.error })
  }
  const imported = await importGeoPackagePair(scenario.files)
  const service = imported.accepted
    ? { accepted: true, figures: figuresFromProject(imported.project) }
    : imported
  return compareScenario({
    scenario,
    expected: figuresFromWorkbook(answers.results),
    service
  })
}

/**
 * @param {object} [options]
 * @param {string} [options.corpusDir] a folder of scenarios; by default the
 *   one committed in the harness (see find-scenario-corpus.js)
 * @param {string[]} [options.only] scenario ids, names or purposes to run
 * @param {(result: object) => void} [options.onResult]
 * @returns {Promise<{ corpusDir: string, unmatched: string[], results: object[] }>}
 *   `unmatched` lists workbooks found without both GeoPackages beside them
 */
export async function runMetricComparison(options = {}) {
  const { corpusDir, only = [], onResult } = options
  const dir = corpusDir ?? findScenarioCorpus()
  if (!dir) {
    throw new Error(
      `No scenarios: check the harness (bng-metric-harness) out beside this repo, or name a folder of scenarios in ${CORPUS_DIR_ENV}`
    )
  }
  const { scenarios, unmatched } = findScenarios(dir)
  const selected = scenarios.filter((s) => isSelected(s, only))
  const answers = await readWorkbookAnswers(
    selected.map((s) => s.files.workbook)
  )
  const results = []
  for (const [i, scenario] of selected.entries()) {
    const result = await compareCorpusScenario(scenario, answers[i])
    onResult?.(result)
    results.push(result)
  }
  return { corpusDir: dir, unmatched, results }
}
