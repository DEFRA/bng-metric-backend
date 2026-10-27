import { describe, expect, test, vi } from 'vitest'

import { setGeometryRefs } from './feature-geometry-refs.js'
import { baselineHabitats, postInterventionHedgerows } from './schema/index.js'

function makeExec() {
  const where = vi.fn().mockResolvedValue(undefined)
  const set = vi.fn().mockReturnValue({ where })
  const update = vi.fn().mockReturnValue({ set })
  return { exec: { update }, update, set, where }
}

describe('setGeometryRefs', () => {
  test('updates the geometry row of each renamed feature in its own table', async () => {
    const { exec, update, set, where } = makeExec()

    await setGeometryRefs(exec, 'project-1', [
      {
        documentKey: 'baseline',
        layer: 'habitats',
        featureId: 'b-1',
        ref: 'B-A1'
      },
      {
        documentKey: 'postIntervention',
        layer: 'hedgerows',
        featureId: 'p-h',
        ref: 'B-H1'
      }
    ])

    expect(update.mock.calls.map(([table]) => table)).toEqual([
      baselineHabitats,
      postInterventionHedgerows
    ])
    expect(set.mock.calls).toEqual([[{ ref: 'B-A1' }], [{ ref: 'B-H1' }]])
    expect(where).toHaveBeenCalledTimes(2)
  })

  test('does nothing when no feature was renamed', async () => {
    const { exec, update } = makeExec()

    await setGeometryRefs(exec, 'project-1', [])

    expect(update).not.toHaveBeenCalled()
  })

  test('skips the red line, whose geometry table has no ref column', async () => {
    const { exec, update } = makeExec()

    await setGeometryRefs(exec, 'project-1', [
      { documentKey: 'baseline', layer: 'redLine', featureId: 'r', ref: 'x' }
    ])

    expect(update).not.toHaveBeenCalled()
  })
})
