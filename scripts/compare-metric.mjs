#!/usr/bin/env node
// Compare the service's figures with the Statutory Biodiversity Metric's, for
// every scenario in the bng-library corpus (BMD-1036), and write a report.
//
//   npm run compare:metric                         # the whole corpus
//   npm run compare:metric -- --only trading-rules # a purpose, or scenario ids
//   npm run compare:metric -- --corpus <dir>       # a generate:scenarios run
//   npm run compare:metric -- --out <dir>          # default metric-comparison/
//
// Writes report.html (filterable, self-contained), report.xlsx (the same as a
// spreadsheet: one row per discrepancy), report.md, summary.md (the
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
const DEFAULT_OUT = 'metric-comparison'
const SHORT_SHA_LENGTH = 7

const { values } = parseArgs({
  options: {
    only: { type: 'string', multiple: true, default: [] },
    corpus: { type: 'string' },
    out: { type: 'string', default: DEFAULT_OUT }
  }
})
const only = values.only.flatMap((v) => v.split(',')).filter(Boolean)

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

const commit = process.env.GITHUB_SHA?.slice(0, SHORT_SHA_LENGTH)
const context = [
  `Corpus: seed ${corpus.seed}, metric template ${corpus.template}${values.corpus ? `, from ${values.corpus}` : ''}.`,
  `Generated ${new Date().toISOString()}${commit ? ` for commit ${commit}` : ''}.`
]

const outDir = path.resolve(values.out)
mkdirSync(outDir, { recursive: true })
const write = (name, content) => writeFileSync(path.join(outDir, name), content)

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
  `${JSON.stringify({ corpus: { seed: corpus.seed, template: corpus.template }, results }, null, JSON_INDENT)}\n`
)

const differing = results.filter((r) => r.discrepancies?.length).length
console.log(
  `${differing} of ${results.length} scenarios differ from the metric. Reports → ${path.join(outDir, 'report.html')} and report.xlsx`
)
