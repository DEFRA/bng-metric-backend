import { TEMPLATE_MAPPING_1_0 } from './template-mapping.js'
import {
  renamedColumns,
  storeTemplateColumnNames
} from './stored-properties.js'

const TEMPLATE = { name: 'bng-service', version: '1.0' }

describe('renamedColumns', () => {
  test('gives the template’s name for each column the pipeline reads under another', () => {
    expect([...renamedColumns(TEMPLATE_MAPPING_1_0.areas)]).toEqual([
      ['Parcel Ref', 'Habitat Ref']
    ])
    expect([...renamedColumns(TEMPLATE_MAPPING_1_0.trees)]).toEqual([
      ['Tree Ref', 'Habitat Ref']
    ])
  })
})

describe('storeTemplateColumnNames', () => {
  const documentOf = (template) => ({
    ...(template && { template }),
    habitats: [
      { ref: 'H001', properties: { 'Parcel Ref': 'H001', Comment: 'a' } }
    ],
    verticalHabitats: [{ ref: 'V001', properties: { 'Parcel Ref': 'V001' } }],
    hedgerows: [{ ref: 'L001', properties: { 'Parcel Ref': 'L001' } }],
    watercourses: [{ ref: 'R001', properties: { 'Parcel Ref': 'R001' } }],
    trees: [{ ref: 'T001', properties: { 'Tree Ref': 'T001' } }]
  })

  test('stores a template file’s references under Habitat Ref, on every layer', () => {
    const document = storeTemplateColumnNames(documentOf(TEMPLATE))

    expect(document.habitats[0].properties).toEqual({
      'Habitat Ref': 'H001',
      Comment: 'a'
    })
    for (const layer of [
      'verticalHabitats',
      'hedgerows',
      'watercourses',
      'trees'
    ]) {
      expect(Object.keys(document[layer][0].properties), layer).toEqual([
        'Habitat Ref'
      ])
    }
  })

  test('copies the properties rather than changing the rows they came from', () => {
    const properties = { 'Parcel Ref': 'H001' }
    const document = documentOf(TEMPLATE)
    document.habitats[0].properties = properties

    storeTemplateColumnNames(document)

    expect(properties).toEqual({ 'Parcel Ref': 'H001' })
  })

  test('leaves a legacy file’s document as it is', () => {
    const document = storeTemplateColumnNames(documentOf(null))

    expect(document).toEqual(documentOf(null))
  })
})
