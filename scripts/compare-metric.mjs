#!/usr/bin/env node
// Compare the service's figures with the Statutory Biodiversity Metric's, for
// every scenario in the bng-library corpus (BMD-1036), and write a report.
//
//   npm run compare:metric                         # the whole corpus
//   npm run compare:metric -- --only trading-rules # a purpose, or scenario ids
//   npm run compare:metric -- --corpus <dir>       # a generate:scenarios run
//   npm run compare:metric -- --update-known       # record today's discrepancies
//
// Writes metric-comparison/report.md and report.json (or --out <dir>). Exits 1
// when the run differs from the discrepancies recorded in
// src/services/metric-comparison/known-discrepancies.json: a new or changed
// discrepancy is a regression, and one that has gone needs the record updating.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

// Before anything imports the config: the importer's perf evidence is noise here.
process.env.LOG_LEVEL ??= 'silent'

const { findRegressions, knownDiscrepanciesFrom, renderComparisonReport } =
  await import('bng-library/metric-compare')
const { runMetricComparison } =
  await import('../src/services/metric-comparison/run-metric-comparison.js')
const { KNOWN_DISCREPANCIES_PATH, readKnownDiscrepancies } =
  await import('../src/services/metric-comparison/known-discrepancies.js')

const JSON_INDENT = 2
const DEFAULT_OUT = 'metric-comparison'

const { values } = parseArgs({
  options: {
    only: { type: 'string', multiple: true, default: [] },
    corpus: { type: 'string' },
    out: { type: 'string', default: DEFAULT_OUT },
    'update-known': { type: 'boolean', default: false }
  }
})
const only = values.only.flatMap((v) => v.split(',')).filter(Boolean)
const partialRun = only.length > 0 || Boolean(values.corpus)

if (values['update-known'] && partialRun) {
  console.error(
    '--update-known records the whole committed corpus: run it without --only or --corpus'
  )
  process.exit(1)
}

console.log(
  `Comparing the service with the metric${only.length ? ` (${only.join(', ')})` : ''}…`
)
const { corpus, results } = await runMetricComparison({
  corpusDir: values.corpus,
  only,
  onResult: (r) =>
    console.log(
      `  ${r.outcome.padEnd('rejected-as-expected'.length)}  ${r.id}${r.discrepancies?.length ? ` — ${r.discrepancies.length} discrepancies` : ''}`
    )
})

/** The recorded discrepancies for the scenarios this run covered. */
function recordedForRun() {
  const known = readKnownDiscrepancies()
  if (!partialRun) {
    return known
  }
  return Object.fromEntries(
    Object.entries(known).filter(([id]) => results.some((r) => r.id === id))
  )
}

const regressions = values['update-known']
  ? []
  : findRegressions(results, recordedForRun())

const outDir = path.resolve(values.out)
mkdirSync(outDir, { recursive: true })
writeFileSync(
  path.join(outDir, 'report.md'),
  renderComparisonReport(results, {
    preamble: [
      `Corpus: seed ${corpus.seed}, metric template \`${corpus.template}\`${values.corpus ? `, from \`${values.corpus}\`` : ''}.`
    ],
    regressions
  })
)
writeFileSync(
  path.join(outDir, 'report.json'),
  `${JSON.stringify({ regressions, results }, null, JSON_INDENT)}\n`
)
console.log(`Report → ${path.join(outDir, 'report.md')}`)

if (values['update-known']) {
  writeFileSync(
    KNOWN_DISCREPANCIES_PATH,
    `${JSON.stringify(knownDiscrepanciesFrom(results), null, JSON_INDENT)}\n`
  )
  console.log(`Recorded the discrepancies → ${KNOWN_DISCREPANCIES_PATH}`)
} else if (regressions.length > 0) {
  console.error(
    `${regressions.length} changes from the recorded discrepancies — see the report. If they are intended, run npm run compare:metric -- --update-known`
  )
  process.exit(1)
} else {
  console.log('No change from the recorded discrepancies.')
}
