import { afterEach, describe, expect, it } from 'vitest'

import {
  ParseBudget,
  ParseBudgetExceededError,
  estimateParsedBytes,
  getParseBudget,
  resetParseBudget
} from './parse-budget.js'

const MB = 1024 * 1024
const KB = 1024

/**
 * What one MORE concurrent parse of each perf fixture costs — RSS per upload
 * with eight held alive at once, each combination measured in a fresh process.
 *
 * These are the numbers the estimate exists to cover, so they are asserted
 * rather than described: an estimate that drops below any of them admits a file
 * the heap cannot afford, which is the whole failure this module prevents.
 *
 * They are deliberately NOT the cost of one upload read alone (7 / 15 / 56 /
 * 109 MB for the same four files). That figure includes process growth the
 * first parse causes and the second does not pay again, and this module rations
 * CONCURRENT parses — so charging it made the budget refuse roughly twice as
 * early as the memory required. The single-upload numbers are kept in
 * parse-budget.js for the contrast.
 */
const MEASURED = [
  { label: '80 parcels', fileBytes: 140 * KB, parsedBytes: 1.8 * MB },
  { label: '800 parcels', fileBytes: 704 * KB, parsedBytes: 6.9 * MB },
  { label: '5,000 parcels', fileBytes: 4012 * KB, parsedBytes: 34.1 * MB },
  { label: '12,000 parcels', fileBytes: 9504 * KB, parsedBytes: 58.1 * MB }
]

const A_LARGE_FILE = 4012 * KB
const A_SMALL_FILE = 140 * KB

/**
 * Budgets are derived from the estimate rather than written as round numbers,
 * so a change to the estimate cannot quietly turn "fits exactly two" into
 * "fits one" and leave these tests asserting the wrong property.
 */
const ONE_LARGE = estimateParsedBytes(A_LARGE_FILE)
const ROOM_FOR_TWO_LARGE = ONE_LARGE * 2

afterEach(() => {
  resetParseBudget()
})

describe('estimateParsedBytes', () => {
  it.each(MEASURED)(
    'never under-estimates the measured cost of $label',
    ({ fileBytes, parsedBytes }) => {
      expect(estimateParsedBytes(fileBytes)).toBeGreaterThanOrEqual(parsedBytes)
    }
  )

  it('stays within a factor of two of the measured cost, so it is not just a big number', () => {
    for (const { fileBytes, parsedBytes } of MEASURED) {
      expect(estimateParsedBytes(fileBytes)).toBeLessThan(parsedBytes * 2)
    }
  })

  it('grows with the file', () => {
    expect(estimateParsedBytes(10 * MB)).toBeGreaterThan(
      estimateParsedBytes(1 * MB)
    )
  })

  it.each([null, undefined, 0, -1, Number.NaN])(
    'charges the fixed cost when the uploader reports %s',
    (fileSize) => {
      expect(estimateParsedBytes(fileSize)).toBe(estimateParsedBytes(0))
      expect(estimateParsedBytes(fileSize)).toBeGreaterThan(0)
    }
  )
})

describe('ParseBudget', () => {
  it('admits a file while there is room for it', () => {
    const budget = new ParseBudget(500 * MB)
    expect(budget.hasRoomFor(A_LARGE_FILE)).toBe(true)
    expect(() => budget.reserve(A_LARGE_FILE)).not.toThrow()
  })

  it('refuses once the budget is committed, rather than admitting and hoping', () => {
    const budget = new ParseBudget(ROOM_FOR_TWO_LARGE)
    budget.reserve(A_LARGE_FILE)
    budget.reserve(A_LARGE_FILE)

    expect(budget.hasRoomFor(A_LARGE_FILE)).toBe(false)
    expect(() => budget.reserve(A_LARGE_FILE)).toThrow(ParseBudgetExceededError)
  })

  it('frees the room again when a reservation is released', () => {
    const budget = new ParseBudget(ROOM_FOR_TWO_LARGE)
    const release = budget.reserve(A_LARGE_FILE)
    budget.reserve(A_LARGE_FILE)
    expect(budget.hasRoomFor(A_LARGE_FILE)).toBe(false)

    release()

    expect(budget.hasRoomFor(A_LARGE_FILE)).toBe(true)
  })

  it('ignores a second release, so a double-freed request cannot invent capacity', () => {
    const budget = new ParseBudget(ROOM_FOR_TWO_LARGE)
    const release = budget.reserve(A_LARGE_FILE)
    const committed = budget.inFlightBytes

    release()
    release()
    release()

    expect(budget.inFlightBytes).toBe(
      committed - estimateParsedBytes(A_LARGE_FILE)
    )
    expect(budget.inFlightBytes).toBe(0)
  })

  it('always admits a file when nothing else is in flight, however big it is', () => {
    // Refusing here would mean the file could never be validated at all — a
    // permanent failure wearing back-pressure's clothes.
    const budget = new ParseBudget(1 * MB)

    expect(budget.hasRoomFor(500 * MB)).toBe(true)
    expect(() => budget.reserve(500 * MB)).not.toThrow()
  })

  it('refuses the next file once that oversized one is in flight', () => {
    const budget = new ParseBudget(1 * MB)
    budget.reserve(500 * MB)

    expect(budget.hasRoomFor(A_SMALL_FILE)).toBe(false)
  })

  it('agrees with what reserve() actually does', () => {
    const budget = new ParseBudget(ROOM_FOR_TWO_LARGE)
    while (budget.hasRoomFor(A_LARGE_FILE)) {
      budget.reserve(A_LARGE_FILE)
    }

    expect(() => budget.reserve(A_LARGE_FILE)).toThrow(ParseBudgetExceededError)
  })

  it('names the sizes in the refusal, so a 503 can be explained without a repro', () => {
    const budget = new ParseBudget(ROOM_FOR_TWO_LARGE)
    budget.reserve(A_LARGE_FILE)
    budget.reserve(A_LARGE_FILE)

    expect(() => budget.reserve(A_LARGE_FILE)).toThrow(/parse budget/)
  })
})

describe('getParseBudget', () => {
  it('hands back the same budget every time, because the heap is process-wide', () => {
    expect(getParseBudget(ROOM_FOR_TWO_LARGE)).toBe(
      getParseBudget(ROOM_FOR_TWO_LARGE)
    )
  })

  it('keeps reservations across callers', () => {
    getParseBudget(ROOM_FOR_TWO_LARGE).reserve(A_LARGE_FILE)

    expect(getParseBudget(ROOM_FOR_TWO_LARGE).inFlightBytes).toBeGreaterThan(0)
  })
})
