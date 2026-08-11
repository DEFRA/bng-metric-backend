import { describe, expect, it } from 'vitest'

import { MAX_YEARS, MAX_YEARS_PLUS } from 'bng-metric-engine'

import {
  DEFAULT_ADVANCE_DELAY_YEARS,
  GPKG_NOT_APPLICABLE,
  parseProposedAdvanceDelayYears
} from './extract-post-intervention-sub-objects.js'

describe('parseProposedAdvanceDelayYears', () => {
  it('defaults missing values to zero', () => {
    expect(parseProposedAdvanceDelayYears(null)).toBe(
      DEFAULT_ADVANCE_DELAY_YEARS
    )
    expect(parseProposedAdvanceDelayYears(undefined)).toBe(
      DEFAULT_ADVANCE_DELAY_YEARS
    )
    expect(parseProposedAdvanceDelayYears('')).toBe(DEFAULT_ADVANCE_DELAY_YEARS)
  })

  it('returns finite numbers verbatim and null for non-finite numbers', () => {
    expect(parseProposedAdvanceDelayYears(2)).toBe(2)
    expect(parseProposedAdvanceDelayYears(Number.NaN)).toBeNull()
    expect(parseProposedAdvanceDelayYears(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('maps N/A strings to null and MAX_YEARS_PLUS to MAX_YEARS', () => {
    expect(parseProposedAdvanceDelayYears(GPKG_NOT_APPLICABLE)).toBeNull()
    expect(parseProposedAdvanceDelayYears(' n/a ')).toBeNull()
    expect(parseProposedAdvanceDelayYears(MAX_YEARS_PLUS)).toBe(MAX_YEARS)
  })

  it('parses numeric strings and rejects unparseable values', () => {
    expect(parseProposedAdvanceDelayYears('3')).toBe(3)
    expect(parseProposedAdvanceDelayYears('not-a-number')).toBeNull()
  })

  it('returns null for unsupported types', () => {
    expect(parseProposedAdvanceDelayYears({})).toBeNull()
  })
})
