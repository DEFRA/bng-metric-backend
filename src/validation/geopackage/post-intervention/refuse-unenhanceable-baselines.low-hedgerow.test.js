// AC5: a Low hedgerow in Good condition whose type the metric's G-6 data lets
// become no Medium hedgerow. Every Low hedgerow has a Medium target in that
// data today, so no real hedgerow breaks the rule; bng-library tests the rule
// against altered data. Here the library is made to report it, to show the
// backend refuses the file and passes the rule on.

import { describe, expect, it, vi } from 'vitest'

import { ERROR_CODES } from '../errors.js'
import { refuseUnenhanceableBaselines } from './refuse-unenhanceable-baselines.js'

const LINE_OF_TREES_BANK = 'Line of trees - associated with bank or ditch'
const RULE = 'low-hedgerow-good-no-medium-target'

vi.mock('bng-library/metric', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    unenhanceableBaseline: (kind, baseline) =>
      kind === actual.ENHANCEMENT_KIND.hedgerow &&
      baseline?.habitat === LINE_OF_TREES_BANK &&
      baseline?.condition === 'Good'
        ? {
            rule: actual.UNENHANCEABLE_BASELINE
              .LOW_HEDGEROW_GOOD_NO_MEDIUM_TARGET,
            mvsOnly: true,
            distinctiveness: 'Low'
          }
        : actual.unenhanceableBaseline(kind, baseline)
  }
})

describe('refuseUnenhanceableBaselines, AC5', () => {
  it('refuses an enhanced Low hedgerow in Good condition with no Medium target', () => {
    const error = refuseUnenhanceableBaselines({
      hedgerows: [
        {
          ref: 'HG1',
          retentionCategory: 'Enhanced',
          baseline: { type: LINE_OF_TREES_BANK, condition: '3. Good' }
        }
      ]
    })

    expect(error.code).toBe(ERROR_CODES.BASELINE_NOT_ENHANCEABLE)
    expect(error.details.sample).toEqual([
      {
        layer: 'hedgerows',
        feature_ref: 'HG1',
        habitat_type: LINE_OF_TREES_BANK,
        condition: 'Good',
        distinctiveness: 'Low',
        rule: RULE,
        mvsOnly: true
      }
    ])
  })
})
