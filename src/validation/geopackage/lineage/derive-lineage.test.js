// Geometry inference and the Created retention category.
//
// An unstamped row is normally sent to the geometry rule. For hedgerows,
// watercourses, trees and vertical areas that is wrong when the row is
// Created: a brand-new planting drawn inside the site would inherit a bogus
// parent from whatever baseline feature it happens to touch. Area habitats
// keep the inference for every unstamped row — the EXACT area reconciliation
// needs full lineage — which is why the behaviour is an option the caller
// sets per habitat type, not a blanket rule.

import { describe, expect, it } from 'vitest'

import { deriveLineage } from './derive-lineage.js'

const LINE_ON_BASELINE = {
  type: 'LineString',
  coordinates: [
    [0, 0],
    [100, 0]
  ]
}

const BASELINE = [{ ref: 'HR-1', geometry: LINE_ON_BASELINE }]

/** A pool that answers any lineage query with full overlap on HR-1. */
function overlappingPool() {
  const calls = []
  return {
    calls,
    query: async (sql, params) => {
      calls.push(sql)
      const [indexes] = params
      return {
        rows: indexes.map((piIndex) => ({
          pi_index: piIndex,
          pi_ref: null,
          baseline_ref: 'HR-1',
          shared_size: 100
        }))
      }
    }
  }
}

describe('deriveLineage with inferCreatedParents disabled', () => {
  it('leaves an unstamped Created row parentless without querying geometry', async () => {
    const pool = overlappingPool()
    const result = await deriveLineage(
      pool,
      [
        {
          piRef: 'HR-NEW-1',
          retentionCategory: 'Created',
          geometry: LINE_ON_BASELINE
        }
      ],
      BASELINE,
      { linear: true, inferCreatedParents: false }
    )

    expect(pool.calls).toEqual([])
    expect(result[0].source).toBe('none')
    expect(result[0].parents).toEqual([])
  })

  it('still sends unstamped continuing rows to the geometry rule', async () => {
    const pool = overlappingPool()
    const result = await deriveLineage(
      pool,
      [
        {
          piRef: 'HR-NEW-1',
          retentionCategory: 'Created',
          geometry: LINE_ON_BASELINE
        },
        {
          piRef: 'HR-1a',
          retentionCategory: 'Retained',
          geometry: LINE_ON_BASELINE
        }
      ],
      BASELINE,
      { linear: true, inferCreatedParents: false }
    )

    expect(pool.calls).toHaveLength(1)
    expect(result[0].source).toBe('none')
    expect(result[1].source).toBe('geometry')
    expect(result[1].parents[0].ref).toBe('HR-1')
  })

  it('still trusts a stamped parent on a Created row', async () => {
    // Built-over ground is Created AND stamped — the stamp, not the
    // category, decides (see the module comment in derive-lineage.js).
    const pool = overlappingPool()
    const result = await deriveLineage(
      pool,
      [
        {
          piRef: 'PR-1a',
          parentRef: 'HR-1',
          retentionCategory: 'Created',
          geometry: LINE_ON_BASELINE
        }
      ],
      BASELINE,
      { linear: true, inferCreatedParents: false }
    )

    expect(pool.calls).toEqual([])
    expect(result[0].source).toBe('stamped')
    expect(result[0].parents[0].ref).toBe('HR-1')
  })
})

describe('deriveLineage default behaviour', () => {
  it('geometry-infers an unstamped Created row when the option is not set', async () => {
    // Area habitats rely on this: every square metre must be accounted
    // against a baseline parcel, Created rows included.
    const pool = overlappingPool()
    const result = await deriveLineage(
      pool,
      [
        {
          piRef: 'PI-POND',
          retentionCategory: 'Created',
          geometry: LINE_ON_BASELINE
        }
      ],
      BASELINE,
      { linear: true }
    )

    expect(pool.calls).toHaveLength(1)
    expect(result[0].source).toBe('geometry')
    expect(result[0].parents[0].ref).toBe('HR-1')
  })
})
