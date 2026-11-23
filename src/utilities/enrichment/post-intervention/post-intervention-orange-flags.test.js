import { describe, expect, it } from 'vitest'

import {
  AREA_BASELINE_BROAD,
  makeAreaHabitat,
  makeCreatedAreaHabitat,
  makeCreatedHedgerow,
  makeCreatedWatercourse,
  makeEnhancedHabitat
} from './enrich-post-intervention-units.fixtures.js'
import { enrichPostInterventionDocumentWithUnits } from './enrich-post-intervention-units.js'
import {
  applyPostInterventionOrangeFlags,
  postInterventionFeatureOrangeFlags
} from './post-intervention-orange-flags.js'

function withAdvance(feature, advanceYears) {
  feature.proposed.advanceYears = advanceYears
  feature.proposed.delayYears = 0
  return feature
}

function withoutOrangeFlags(document) {
  const copy = structuredClone(document)
  for (const layer of ['habitats', 'trees', 'hedgerows', 'watercourses']) {
    for (const feature of copy[layer] ?? []) {
      delete feature.orangeFlags
    }
  }
  return copy
}

describe('postInterventionFeatureOrangeFlags', () => {
  it('reads the priced proposed side', () => {
    const habitat = {
      retentionCategory: 'Created',
      proposed: {
        type: 'Other neutral grassland',
        broadType: 'Grassland',
        condition: 'Good',
        distinctivenessScore: 4,
        standardTimeToTargetCondition: '10',
        advanceYears: 1,
        delayYears: 0
      }
    }
    expect(postInterventionFeatureOrangeFlags(habitat, 'habitats')).toEqual([
      'FLAG3'
    ])
  })

  it('compares an enhanced habitat with the baseline side it enhances (FLAG8)', () => {
    const habitat = {
      retentionCategory: 'Enhanced',
      baseline: { type: 'Modified grassland', broadType: 'Grassland' },
      proposed: { type: 'Mixed scrub', broadType: 'Heathland and shrub' }
    }
    expect(postInterventionFeatureOrangeFlags(habitat, 'habitats')).toEqual([
      'FLAG8'
    ])
  })

  it('reads a retention category stored only on the baseline side', () => {
    const habitat = {
      baseline: { retentionCategory: 'Created' },
      proposed: { type: 'Watercourse footprint' }
    }
    expect(postInterventionFeatureOrangeFlags(habitat, 'habitats')).toEqual([
      'FLAG10'
    ])
  })
})

describe('enrichPostInterventionDocumentWithUnits', () => {
  it('derives each feature its orange flags once it is priced', () => {
    const document = {
      habitats: [
        withAdvance(makeAreaHabitat(), 3),
        withAdvance(makeCreatedAreaHabitat(), 3),
        withAdvance(makeEnhancedHabitat(), 30)
      ],
      hedgerows: [withAdvance(makeCreatedHedgerow(), 3)],
      watercourses: [withAdvance(makeCreatedWatercourse(), 30)]
    }
    enrichPostInterventionDocumentWithUnits(document)

    expect(document.habitats.map((h) => h.orangeFlags)).toEqual([
      [],
      ['FLAG3'],
      ['FLAG1', 'FLAG6']
    ])
    expect(document.hedgerows[0].orangeFlags).toEqual(['FLAG4'])
    expect(document.watercourses[0].orangeFlags).toEqual(['FLAG1', 'FLAG6'])
  })

  it('keeps an enhanced habitat on its baseline broad habitat unflagged', () => {
    const habitat = withAdvance(makeEnhancedHabitat(), 0)
    expect(habitat.baseline.broadType).toBe(AREA_BASELINE_BROAD)
    const document = { habitats: [habitat] }
    enrichPostInterventionDocumentWithUnits(document)
    expect(document.habitats[0].orangeFlags).toEqual([])
  })

  it('changes no other field when it applies the flags (AC11)', () => {
    const document = {
      habitats: [
        withAdvance(makeCreatedAreaHabitat(), 3),
        withAdvance(makeEnhancedHabitat(), 30)
      ],
      hedgerows: [withAdvance(makeCreatedHedgerow(), 3)]
    }
    enrichPostInterventionDocumentWithUnits(document)
    const before = withoutOrangeFlags(document)

    applyPostInterventionOrangeFlags(document)

    expect(withoutOrangeFlags(document)).toEqual(before)
  })
})
