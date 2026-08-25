import { describe, test, expect } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'

import {
  featureByIdColumns,
  habitatByIdColumns,
  readFeatureMatch
} from './project-features.js'

const FEATURE_ID = 'aa0e8400-e29b-41d4-a716-446655440001'
const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'

const render = (column) => new PgDialect().sqlToQuery(column.getSQL())

describe('#featureByIdColumns', () => {
  test('Should select the project id and one column per feature layer', () => {
    const columns = featureByIdColumns({
      documentKey: 'baseline',
      featureId: FEATURE_ID
    })

    expect(Object.keys(columns)).toEqual([
      'id',
      'habitats',
      'trees',
      'hedgerows',
      'watercourses'
    ])
  })

  test('Should search the layer in Postgres rather than return the document', () => {
    const columns = featureByIdColumns({
      documentKey: 'postIntervention',
      featureId: FEATURE_ID
    })

    const { sql, params } = render(columns.hedgerows)

    expect(sql).toContain('jsonb_path_query_first')
    expect(params).toEqual([
      'postIntervention',
      'hedgerows',
      '$[*] ? (@.featureId == $f)',
      FEATURE_ID
    ])
  })

  test('Should bind the featureId rather than build the jsonpath from it', () => {
    const columns = featureByIdColumns({
      documentKey: 'baseline',
      // A jsonpath-shaped id would rewrite the filter if it were interpolated.
      featureId: '" || true || "'
    })

    const { sql, params } = render(columns.habitats)

    expect(sql).not.toContain('true')
    expect(params).toContain('" || true || "')
  })
})

describe('#habitatByIdColumns', () => {
  test('Should select only the habitats layer', () => {
    const columns = habitatByIdColumns({ featureId: FEATURE_ID })

    expect(Object.keys(columns)).toEqual(['id', 'habitat'])

    const { params } = render(columns.habitat)
    expect(params).toEqual([
      'baseline',
      'habitats',
      '$[*] ? (@.featureId == $f)',
      FEATURE_ID
    ])
  })
})

describe('#readFeatureMatch', () => {
  const habitat = { featureId: FEATURE_ID, ref: '1' }

  test('Should return the match with the type its layer implies', () => {
    const row = {
      id: PROJECT_ID,
      habitats: null,
      trees: null,
      hedgerows: habitat,
      watercourses: null
    }

    expect(readFeatureMatch(row, FEATURE_ID)).toEqual({
      type: 'hedgerow',
      key: 'hedgerows',
      feature: habitat
    })
  })

  test('Should return null when no layer held the feature', () => {
    const row = {
      id: PROJECT_ID,
      habitats: null,
      trees: null,
      hedgerows: null,
      watercourses: null
    }

    expect(readFeatureMatch(row, FEATURE_ID)).toBeNull()
  })

  test('Should return null for a row with no layer columns at all', () => {
    expect(readFeatureMatch(undefined, FEATURE_ID)).toBeNull()
  })

  test('Should throw when the same featureId is in more than one layer', () => {
    const row = {
      id: PROJECT_ID,
      habitats: habitat,
      trees: null,
      hedgerows: habitat,
      watercourses: null
    }

    // Duplicate ids across layers mean upstream corruption — returning
    // whichever was projected first would hide it.
    expect(() => readFeatureMatch(row, FEATURE_ID)).toThrow(
      `featureId ${FEATURE_ID} appears in multiple layers: habitat, hedgerow`
    )
  })
})
