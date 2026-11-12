import { describe, expect, it } from 'vitest'

import { ERROR_CODES } from './errors.js'
import { checkIrreplaceableTrees } from './irreplaceable-tree-check.js'

const TABLE = 'Individual Trees Post-Intervention'

function tree(irreplaceable, extra = {}) {
  return {
    properties: { fid: 1, 'Irreplaceable Habitat': irreplaceable, ...extra }
  }
}

const layers = (trees, table = TABLE) => ({
  trees,
  layerTables: { trees: table }
})

describe('checkIrreplaceableTrees', () => {
  it.each(['No', 'no', '  NO  '])(
    'accepts a tree whose Irreplaceable Habitat is %j',
    (value) => {
      expect(checkIrreplaceableTrees(layers([tree(value)]))).toBeNull()
    }
  )

  // For a tree the column is mandatory: anything but "No" is treated as
  // irreplaceable until the surveyor says otherwise.
  it.each(['Yes', '', '  ', null, 'Unknown', 1])(
    'refuses a tree whose Irreplaceable Habitat is %j',
    (value) => {
      expect(checkIrreplaceableTrees(layers([tree(value)]))).toMatchObject({
        code: ERROR_CODES.IRREPLACEABLE_TREE,
        details: { count: 1 }
      })
    }
  )

  it('accepts a legacy file, which has no Irreplaceable Habitat column', () => {
    expect(
      checkIrreplaceableTrees({ trees: [{ properties: { fid: 1 } }] })
    ).toBeNull()
  })

  it('accepts a file with no trees', () => {
    expect(checkIrreplaceableTrees({})).toBeNull()
  })

  it('refuses every tree not marked No in one error, naming each', () => {
    const error = checkIrreplaceableTrees(
      layers([
        tree('Yes', { 'Tree Ref': 'T001' }),
        tree('No', { fid: 2, 'Tree Ref': 'T002' }),
        tree('', { fid: 3, 'Tree Ref': '' })
      ])
    )

    expect(error).toEqual({
      code: ERROR_CODES.IRREPLACEABLE_TREE,
      message:
        'One or more trees have an Irreplaceable Habitat other than "No". Irreplaceable Habitat must be "No" for every tree, because the service does not accept irreplaceable trees: Individual Trees Post-Intervention Habitat Ref T001, Individual Trees Post-Intervention fid 3',
      details: {
        count: 2,
        sample: [
          {
            layer: 'trees',
            table: TABLE,
            feature_ref: 'T001',
            fid: 1,
            idx: 0
          },
          {
            layer: 'trees',
            table: TABLE,
            feature_ref: null,
            fid: 3,
            idx: 2
          }
        ]
      }
    })
  })

  it('caps the trees it lists, and says how many more there are', () => {
    const trees = Array.from({ length: 52 }, (_, i) =>
      tree('Yes', { fid: i + 1, 'Tree Ref': `T${i + 1}` })
    )

    const error = checkIrreplaceableTrees(layers(trees))

    expect(error.details.count).toBe(52)
    expect(error.details.sample).toHaveLength(50)
    expect(error.message).toMatch(/\(and 2 more\)$/)
  })
})
