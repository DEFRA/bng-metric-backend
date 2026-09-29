#!/usr/bin/env node
// Compare the service's figures with the Statutory Biodiversity Metric's, for
// every scenario in a folder of scenarios (BMD-1036), and write a report.
//
//   npm run compare:metric                         # every committed scenario
//   npm run compare:metric -- --only trading-rules # a purpose, or scenario ids
//   npm run compare:metric -- --corpus <dir>       # any folder of scenarios
//
// Writes, to metric-comparison/ in this repo, report.html (a short, self-contained summary), report.xlsx (every
// difference at full precision, one row each), report.md, summary.md (the
// report without each scenario's detail, for a CI job summary) and
// report.json. The report is for people to judge: differences never make
// this exit non-zero. Only a comparison that cannot run does.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'

// Before anything imports the config: the importer's perf evidence is noise here.
process.env.LOG_LEVEL ??= 'silent'

const { renderComparisonHtml, renderComparisonReport, renderComparisonXlsx } =
  await import('bng-library/metric-compare')
const { runMetricComparison } =
  await import('../src/services/metric-comparison/run-metric-comparison.js')

const JSON_INDENT = 2
const SHORT_SHA_LENGTH = 7
// Fixed rather than a flag: both workflows upload this folder, and nothing
// from the command line reaches the file system.
const OUT_DIR = path.resolve(import.meta.dirname, '..', 'metric-comparison')

const { values } = parseArgs({
  options: {
    only: { type: 'string', multiple: true, default: [] },
    corpus: { type: 'string' }
  }
})
const only = values.only.flatMap((v) => v.split(',')).filter(Boolean)

const onlySuffix = only.length ? ` (${only.join(', ')})` : ''
console.log(`Comparing the service with the metric${onlySuffix}…`)
const { corpusDir, unmatched, results } = await runMetricComparison({
  corpusDir: values.corpus,
  only,
  onResult: (r) => {
    const discrepancySuffix = r.discrepancies?.length
      ? ` — ${r.discrepancies.length} discrepancies`
      : ''
    console.log(
      `  ${r.outcome.padEnd('rejected-as-expected'.length)}  ${r.id}${discrepancySuffix}`
    )
  }
})
for (const workbook of unmatched) {
  console.warn(`  skipped ${workbook}: no GeoPackage pair beside it`)
}

const commit = process.env.GITHUB_SHA?.slice(0, SHORT_SHA_LENGTH)
const commitSuffix = commit ? ` for commit ${commit}` : ''
const context = [
  `Scenarios from ${corpusDir}.`,
  `Generated ${new Date().toISOString()}${commitSuffix}.`
]

mkdirSync(OUT_DIR, { recursive: true })
const write = (name, content) =>
  writeFileSync(path.join(OUT_DIR, name), content)

write('report.html', renderComparisonHtml(results, { context }))
write('report.xlsx', renderComparisonXlsx(results, { context }))
write('report.md', renderComparisonReport(results, { preamble: context }))
write(
  'summary.md',
  renderComparisonReport(results, {
    preamble: [
      ...context,
      'The full report, with every discrepancy, is `report.html` (and `report.xlsx`) in the `metric-comparison` artifact.'
    ],
    details: false
  })
)
write(
  'report.json',
  `${JSON.stringify({ corpusDir, unmatched, results }, null, JSON_INDENT)}\n`
)

const differing = results.filter((r) => r.discrepancies?.length).length
const unreadable = results.filter(
  (r) => r.outcome === 'workbook-unreadable'
).length
const unreadableSuffix = unreadable
  ? `; ${unreadable} workbook(s) could not be read, so were not compared`
  : ''
console.log(
  `${differing} of ${results.length} scenarios differ from the metric${unreadableSuffix}. Reports → ${path.join(OUT_DIR, 'report.html')} and report.xlsx`
)
