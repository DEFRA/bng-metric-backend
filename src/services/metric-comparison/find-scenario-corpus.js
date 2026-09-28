// Where the metric comparison's scenario corpus is.
//
// The corpus — each scenario's GeoPackage pair beside its metric workbook, and
// the manifest recording the workbooks' answers — is committed in the harness
// repo at example-files/permutations/, where `generate:scenarios` writes it.
// This repo carries no copy. Locally the harness is checked out beside this
// one; CI fetches it (see .github/workflows) and names the folder in
// METRIC_CORPUS_DIR.

import fs from 'node:fs'
import path from 'node:path'

/** Names a corpus folder explicitly, ahead of looking for the harness. */
export const CORPUS_DIR_ENV = 'METRIC_CORPUS_DIR'

/** Name in the harness repo's package.json, used to identify it by content. */
const HARNESS_PACKAGE_NAME = 'bng-metric-harness'
const CORPUS_IN_HARNESS = path.join('example-files', 'permutations')
const MANIFEST = 'manifest.json'

// This file is src/services/metric-comparison/; the repo root is three up.
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')

function isHarnessCheckout(dir) {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8')
    )
    return manifest.name === HARNESS_PACKAGE_NAME
  } catch {
    return false
  }
}

/**
 * The harness beside this repo. The directory name is a developer's choice,
 * so the harness is recognised by its package.json.
 */
function harnessBeside(repoRoot) {
  const parent = path.dirname(repoRoot)
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => path.join(parent, entry.name))
    .find(isHarnessCheckout)
}

/**
 * @param {{ env?: Record<string, string | undefined>, repoRoot?: string }} [options]
 * @returns {string | null} the corpus folder, or null when there is none to
 *   hand — a checkout of this repo alone
 */
export function findScenarioCorpus(options = {}) {
  const { env = process.env, repoRoot = REPO_ROOT } = options
  if (env[CORPUS_DIR_ENV]) {
    return path.resolve(env[CORPUS_DIR_ENV])
  }
  const harness = harnessBeside(repoRoot)
  const corpus = harness ? path.join(harness, CORPUS_IN_HARNESS) : null
  return corpus && fs.existsSync(path.join(corpus, MANIFEST)) ? corpus : null
}
