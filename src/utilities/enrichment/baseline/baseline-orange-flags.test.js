import { describe, expect, it } from 'vitest'

import {
  applyBaselineOrangeFlags,
  baselineFeatureOrangeFlags
} from './baseline-orange-flags.js'
import { enrichBaselineDocumentWithUnits } from './enrich-baseline-units.js'

function baselineDocument() {
  return {
    habitats: [
      {
        featureId: 'h1',
        type: 'Other neutral grassland',
        broadType: 'Grassland',
        condition: 'Fairly Poor',
        sizeSquareMetres: 10_000
      },
      {
        featureId: 'h2',
        type: 'Watercourse footprint',
        broadType: 'Watercourse footprint',
        condition: 'Condition Assessment N/A',
        sizeSquareMetres: 500
      },
      {
        featureId: 'h3',
        type: 'Modified grassland',
        broadType: 'Grassland',
        condition: 'Good',
        sizeSquareMetres: 10_000
      }
    ],
    hedgerows: [
      {
        featureId: 'l1',
        type: 'Native hedgerow',
        condition: 'Fairly Good',
        sizeMetres: 100
      }
    ],
    watercourses: [
      {
        featureId: 'w1',
        type: 'Ditches',
        condition: 'Fairly Good',
        sizeMetres: 100
      },
      {
        featureId: 'w2',
        type: 'Other rivers and streams',
        condition: 'Fairly Good',
        sizeMetres: 100
      }
    ]
  }
}

const flagsByFeatureId = (document) =>
  Object.fromEntries(
    ['habitats', 'hedgerows', 'watercourses'].flatMap((layer) =>
      document[layer].map((f) => [f.featureId, f.orangeFlags])
    )
  )

describe('baselineFeatureOrangeFlags', () => {
  it('reads the feature by its layer', () => {
    const document = baselineDocument()
    expect(
      baselineFeatureOrangeFlags(document.watercourses[0], 'watercourses')
    ).toEqual(['FLAG7'])
    expect(
      baselineFeatureOrangeFlags(document.watercourses[0], 'hedgerows')
    ).toEqual([])
  })
})

describe('applyBaselineOrangeFlags', () => {
  it('sets every feature its flags, and an empty list where none apply', () => {
    const document = baselineDocument()
    applyBaselineOrangeFlags(document)
    expect(flagsByFeatureId(document)).toEqual({
      h1: ['FLAG7'],
      h2: ['FLAG10'],
      h3: [],
      l1: [],
      w1: ['FLAG7'],
      w2: []
    })
  })

  it('ignores a missing document or layer', () => {
    expect(() => applyBaselineOrangeFlags(undefined)).not.toThrow()
    const document = { habitats: [] }
    applyBaselineOrangeFlags(document)
    expect(document).toEqual({ habitats: [] })
  })
})

describe('enrichBaselineDocumentWithUnits', () => {
  it('derives the orange flags on import', () => {
    const document = enrichBaselineDocumentWithUnits(baselineDocument())
    expect(flagsByFeatureId(document)).toMatchObject({
      h1: ['FLAG7'],
      h2: ['FLAG10'],
      w1: ['FLAG7']
    })
  })

  it('changes no other field when it applies the flags (AC11)', () => {
    const enriched = enrichBaselineDocumentWithUnits(baselineDocument())
    const withoutFlags = structuredClone(enriched)
    for (const layer of ['habitats', 'hedgerows', 'watercourses']) {
      for (const feature of withoutFlags[layer]) {
        delete feature.orangeFlags
      }
    }
    const reapplied = structuredClone(withoutFlags)
    applyBaselineOrangeFlags(reapplied)
    for (const layer of ['habitats', 'hedgerows', 'watercourses']) {
      for (const feature of reapplied[layer]) {
        delete feature.orangeFlags
      }
    }
    expect(reapplied).toEqual(withoutFlags)
  })
})
