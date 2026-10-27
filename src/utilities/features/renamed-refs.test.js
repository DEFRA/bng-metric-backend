import { describe, expect, test } from 'vitest'

import { listRenamedRefs } from './renamed-refs.js'

const project = {
  baseline: {
    habitats: [
      { featureId: 'b-1', ref: 'A1' },
      { featureId: 'b-2', ref: 'A2' }
    ]
  },
  postIntervention: {
    habitats: [
      { featureId: 'p-1', ref: 'A1' },
      { featureId: 'p-2', ref: 'A2' }
    ],
    hedgerows: [{ featureId: 'p-h', ref: 'H1' }]
  }
}

describe('listRenamedRefs', () => {
  test('lists the edited baseline feature and the post-intervention rows that followed it', () => {
    expect(
      listRenamedRefs(project, {
        documentKey: 'baseline',
        layer: 'habitats',
        feature: { featureId: 'b-1', ref: 'B-A1' },
        postIntervention: {
          habitats: [
            { featureId: 'p-1', ref: 'B-A1' },
            { featureId: 'p-2', ref: 'A2' }
          ],
          hedgerows: [{ featureId: 'p-h', ref: 'H1' }]
        }
      })
    ).toEqual([
      {
        documentKey: 'baseline',
        layer: 'habitats',
        featureId: 'b-1',
        ref: 'B-A1'
      },
      {
        documentKey: 'postIntervention',
        layer: 'habitats',
        featureId: 'p-1',
        ref: 'B-A1'
      }
    ])
  })

  test('lists nothing when the edit kept the ref', () => {
    expect(
      listRenamedRefs(project, {
        documentKey: 'baseline',
        layer: 'habitats',
        feature: { featureId: 'b-1', ref: 'A1' },
        postIntervention: project.postIntervention
      })
    ).toEqual([])
  })

  test('copes with a project that has no post-intervention document', () => {
    expect(
      listRenamedRefs(
        { baseline: project.baseline },
        {
          documentKey: 'baseline',
          layer: 'habitats',
          feature: { featureId: 'b-2', ref: 'B-A2' },
          postIntervention: null
        }
      )
    ).toEqual([
      {
        documentKey: 'baseline',
        layer: 'habitats',
        featureId: 'b-2',
        ref: 'B-A2'
      }
    ])
  })
})
