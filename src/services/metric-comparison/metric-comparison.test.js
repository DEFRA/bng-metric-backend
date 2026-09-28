// The metric comparison (BMD-1036): every scenario in the bng-library corpus
// imported through the upload pipeline and compared, figure by figure, with
// the Statutory Biodiversity Metric's own answers.
//
// Differences between the service and the metric do not fail these tests —
// they are reported (`npm run compare:metric`, and in CI as an HTML report)
// for people to judge. These tests check the comparison itself runs.

import { describe, expect, it } from 'vitest'
import { OUTCOME } from 'bng-library/metric-compare'

import { runMetricComparison } from './run-metric-comparison.js'

// The whole corpus runs in a couple of seconds; the margin covers a slow runner.
const CORPUS_TIMEOUT_MS = 60_000

describe('metric comparison', () => {
  it(
    'compares every corpus scenario',
    async () => {
      const { corpus, results } = await runMetricComparison()

      expect(results).toHaveLength(corpus.scenarios.length)
      for (const result of results) {
        expect(Object.values(OUTCOME)).toContain(result.outcome)
      }
      expect(results.some((r) => r.compared > 0)).toBe(true)
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
