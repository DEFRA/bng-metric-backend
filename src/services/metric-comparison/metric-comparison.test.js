// The metric comparison as a regression gate (BMD-1036).
//
// Every scenario in the bng-library corpus is imported through the upload
// pipeline and compared, figure by figure, with the Statutory Biodiversity
// Metric's own answers. The service does not agree with the metric everywhere
// yet, so the discrepancies already known are recorded in
// known-discrepancies.json; this fails when a run differs from that record.
//
// On failure, run `npm run compare:metric` for the full report. If the change
// is intended — a fix, or a deliberate change to a calculation — record it with
// `npm run compare:metric -- --update-known` and commit the diff.

import { describe, expect, it } from 'vitest'
import { findRegressions, OUTCOME } from 'bng-library/metric-compare'

import { readKnownDiscrepancies } from './known-discrepancies.js'
import { runMetricComparison } from './run-metric-comparison.js'

// The whole corpus runs in a couple of seconds; the margin covers a slow runner.
const CORPUS_TIMEOUT_MS = 60_000

describe('metric comparison', () => {
  it(
    'matches the recorded discrepancies for every corpus scenario',
    async () => {
      const { results } = await runMetricComparison()

      expect(findRegressions(results, readKnownDiscrepancies())).toEqual([])
    },
    CORPUS_TIMEOUT_MS
  )

  it('selects scenarios by purpose or by id', async () => {
    const { results } = await runMetricComparison({
      only: ['net-gain', 'trading-all-met']
    })

    expect(results.map((r) => r.id).sort()).toEqual([
      'net-gain-met',
      'net-gain-unmet',
      'trading-all-met'
    ])
  })

  it('reports a scenario built on invalid data that the service refuses as expected', async () => {
    const { results } = await runMetricComparison({
      only: ['invalid-area-advance-and-delay']
    })

    expect(results[0].outcome).toBe(OUTCOME.rejectedAsExpected)
  })
})
