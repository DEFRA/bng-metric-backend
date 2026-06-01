import { describe, expect, it } from 'vitest'

import { MAX_SIG_FIGS, roundToSigFigs } from './utils.js'

describe('MAX_SIG_FIGS', () => {
  it('equals 15', () => {
    expect(MAX_SIG_FIGS).toBe(15)
  })
})

describe('roundToSigFigs', () => {
  it('removes floating-point artefact from a multiplication result', () => {
    // 1 * 8 * 3 * 0.8 * 0.98 * 1 produces 18.816000000000003 in JS due to IEEE 754
    const raw = 1 * 8 * 3 * 0.8 * 0.98 * 1
    expect(roundToSigFigs(raw)).toBe(18.816)
  })

  it('returns 0 unchanged', () => {
    expect(roundToSigFigs(0)).toBe(0)
  })

  it('returns Infinity unchanged', () => {
    expect(roundToSigFigs(Infinity)).toBe(Infinity)
  })

  it('returns -Infinity unchanged', () => {
    expect(roundToSigFigs(-Infinity)).toBe(-Infinity)
  })

  it('returns NaN unchanged', () => {
    expect(roundToSigFigs(Number.NaN)).toBeNaN()
  })

  it('preserves a value that already fits within 15 significant figures', () => {
    expect(roundToSigFigs(18.816)).toBe(18.816)
  })

  it('handles a negative value', () => {
    const raw = -(1 * 8 * 3 * 0.8 * 0.98 * 1)
    expect(roundToSigFigs(raw)).toBe(-18.816)
  })

  it('handles a very small value', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS
    expect(roundToSigFigs(0.1 + 0.2)).toBe(0.3)
  })

  it('handles a large integer value', () => {
    expect(roundToSigFigs(1234567890)).toBe(1234567890)
  })
})
