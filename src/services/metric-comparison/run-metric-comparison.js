// Run the metric comparison (BMD-1036): import every scenario in the corpus
// through the service's own upload pipeline and compare what it computes with
// the Statutory Biodiversity Metric's answers for the same site.
//
// The comparison itself lives in bng-library (`bng-library/metric-compare`);
// the corpus, with the metric's answers, in the harness (find-scenario-corpus.js);
// the import is this service's. So a change to either side — the engine in the
// library, or the extraction and enrichment here — is measured against the
// metric by the same run.

import {
  compareScenario,
  figuresFromProject,
  figuresFromWorkbook,
  loadScenarioCorpus
} from 'bng-library/metric-compare'

import { CORPUS_DIR_ENV, findScenarioCorpus } from './find-scenario-corpus.js'
import { importGeoPackagePair } from './import-geopackage-pair.js'

/**
 * A scenario is selected by its id or its purpose; no filter selects all.
 *
 * @param {{ id: string, purpose: string }} scenario
 * @param {string[]} only
 */
function isSelected(scenario, only) {
  return (
    only.length === 0 ||
    only.includes(scenario.id) ||
    only.includes(scenario.purpose)
  )
}

/**
 * @param {import('bng-library/metric-compare').CorpusScenario} scenario
 */
export async function compareCorpusScenario(scenario) {
  const imported = await importGeoPackagePair(scenario.files)
  const service = imported.accepted
    ? { accepted: true, figures: figuresFromProject(imported.project) }
    : imported
  return compareScenario({
    scenario,
    expected: figuresFromWorkbook(scenario.metric),
    service
  })
}

/**
 * @param {object} [options]
 * @param {string} [options.corpusDir] a scenario corpus; by default the one
 *   committed in the harness (see find-scenario-corpus.js)
 * @param {string[]} [options.only] scenario ids or purposes to run
 * @param {(result: object) => void} [options.onResult]
 * @returns {Promise<{ corpus: object, results: object[] }>}
 */
export async function runMetricComparison(options = {}) {
  const { corpusDir, only = [], onResult } = options
  const dir = corpusDir ?? findScenarioCorpus()
  if (!dir) {
    throw new Error(
      `No scenario corpus: check the harness (bng-metric-harness) out beside this repo, or name a generate:scenarios output in ${CORPUS_DIR_ENV}`
    )
  }
  const corpus = loadScenarioCorpus(dir)
  const results = []
  for (const scenario of corpus.scenarios.filter((s) => isSelected(s, only))) {
    const result = await compareCorpusScenario(scenario)
    onResult?.(result)
    results.push(result)
  }
  return { corpus, results }
}
