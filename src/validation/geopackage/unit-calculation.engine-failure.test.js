// Defensive-path coverage for recomputeWatercourse (BMD-597). These branches
// only fire on inputs the engine/reference data should never produce, so they
// need the collaborators stubbed rather than real data:
//
//   - the reference band resolves but its score is not a number, and
//   - the engine throws something other than a BaselineLookupError.
//
// Kept in a separate file so the main unit-calculation suite keeps exercising
// the real engine and reference tables.
import { describe, test, expect, vi } from 'vitest'
import { recomputeWatercourse } from './unit-calculation.js'

vi.mock('bng-metric-engine', async (importActual) => {
  const actual = await importActual()
  return {
    ...actual,
    // Simulate an unexpected engine fault (not a "Not Possible" lookup miss).
    calculateWatercourseBaseline: vi.fn(() => {
      throw new Error('engine boom')
    })
  }
})

vi.mock('../reference/habitat-reference.js', async (importActual) => {
  const actual = await importActual()
  return {
    ...actual,
    WATERCOURSE_DISTINCTIVENESS_CATEGORIES: {
      'Real river': 'High',
      'Scoreless river': 'PhantomBand'
    },
    watercourseDistinctivenessScores: {
      High: { score: 6 }
      // 'PhantomBand' deliberately absent → score resolves to undefined.
    }
  }
})

describe('recomputeWatercourse — defensive paths', () => {
  const fullEdits = {
    condition: 'Moderate',
    watercourseEncroachment: 'Minor',
    riparianEncroachment: 'Minor/Minor',
    sizeMetres: 1000
  }

  test('Incomplete + null distinctiveness when the band has no numeric score', () => {
    const result = recomputeWatercourse({
      habitatType: 'Scoreless river',
      ...fullEdits
    })
    expect(result).toMatchObject({
      distinctiveness: null,
      distinctivenessScore: null,
      units: 0,
      status: 'Incomplete'
    })
  })

  test('rethrows an unexpected (non-BaselineLookupError) engine failure', () => {
    expect(() =>
      recomputeWatercourse({ habitatType: 'Real river', ...fullEdits })
    ).toThrow('engine boom')
  })
})
