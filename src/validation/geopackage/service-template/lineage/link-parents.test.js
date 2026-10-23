import { describe, expect, it } from 'vitest'

import { linkToParents } from './link-parents.js'

const PARCEL_UUID = 'de9d1450-90f7-584a-9710-edf7ec189de4'
const HEDGE_UUID = '058245bc-2cce-58fa-9b8f-de304545f380'
const PARCEL_ID = '6d5f2c1e-8f43-4a8e-9b51-2a3c4d5e6f70'
const HEDGE_ID = '7e6a3d2f-9a54-4b9f-8c62-3b4d5e6f7081'

const baseline = {
  habitats: [
    {
      featureId: PARCEL_ID,
      ref: 'H001',
      properties: { feature_uuid: PARCEL_UUID }
    }
  ],
  hedgerows: [
    {
      featureId: HEDGE_ID,
      ref: 'HG001',
      properties: { feature_uuid: HEDGE_UUID }
    }
  ],
  watercourses: []
}

const row = (retentionCategory, parentUuid) => ({
  retentionCategory,
  properties: { parent_uuid: parentUuid }
})

describe('linkToParents', () => {
  it('gives each linked feature its parent’s featureId, whatever its Retention Category', () => {
    const postIntervention = {
      habitats: [
        row('Retained', PARCEL_UUID),
        row('Enhanced', ` ${PARCEL_UUID} `),
        row('Created', PARCEL_UUID)
      ],
      hedgerows: [row('Retained', HEDGE_UUID)],
      watercourses: []
    }

    linkToParents(postIntervention, baseline)

    expect(postIntervention.habitats.map((f) => f.parentFeatureId)).toEqual([
      PARCEL_ID,
      PARCEL_ID,
      PARCEL_ID
    ])
    expect(postIntervention.hedgerows[0].parentFeatureId).toBe(HEDGE_ID)
  })

  it('leaves a feature that names no parent without one', () => {
    const postIntervention = {
      habitats: [row('Created', null), row('Created', '')]
    }

    linkToParents(postIntervention, baseline)

    expect(postIntervention.habitats[0]).not.toHaveProperty('parentFeatureId')
    expect(postIntervention.habitats[1]).not.toHaveProperty('parentFeatureId')
  })

  it('looks for the parent in the feature’s own layer only', () => {
    const postIntervention = { hedgerows: [row('Retained', PARCEL_UUID)] }

    linkToParents(postIntervention, baseline)

    expect(postIntervention.hedgerows[0]).not.toHaveProperty('parentFeatureId')
  })

  it('links no feature to a uuid two baseline features share', () => {
    const shared = {
      habitats: [
        ...baseline.habitats,
        {
          featureId: HEDGE_ID,
          ref: 'H001 copy',
          properties: { feature_uuid: PARCEL_UUID }
        },
        {
          featureId: PARCEL_ID,
          ref: 'H001 again',
          properties: { feature_uuid: PARCEL_UUID }
        }
      ]
    }
    const postIntervention = { habitats: [row('Retained', PARCEL_UUID)] }

    linkToParents(postIntervention, shared)

    expect(postIntervention.habitats[0]).not.toHaveProperty('parentFeatureId')
  })

  it('links nothing without a baseline', () => {
    const postIntervention = { habitats: [row('Retained', PARCEL_UUID)] }

    expect(linkToParents(postIntervention, undefined)).toBe(postIntervention)
    expect(postIntervention.habitats[0]).not.toHaveProperty('parentFeatureId')
  })
})
