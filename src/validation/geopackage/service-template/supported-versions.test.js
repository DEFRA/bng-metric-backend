import {
  CURRENT_TEMPLATE_VERSION,
  TEMPLATE_SCHEMA
} from 'bng-library/bng-service'

import {
  supportedTemplateVersions,
  templateForVersion,
  toStructuralSchema
} from './supported-versions.js'

describe('supported template versions', () => {
  test('reads version 1.0 only, for now', () => {
    expect(supportedTemplateVersions()).toEqual(['1.0'])
    expect(templateForVersion('1.0')).not.toBeNull()
  })

  test('does not read a version that is not listed', () => {
    expect(templateForVersion('2.0')).toBeNull()
    expect(templateForVersion('1')).toBeNull()
  })

  test('reads the version bng-library holds the template for', () => {
    // A bng-library that moves to a new template version must come with a
    // decision about reading it; this fails until that decision is made.
    expect(supportedTemplateVersions()).toContain(CURRENT_TEMPLATE_VERSION)
  })
})

describe('toStructuralSchema', () => {
  const schema = toStructuralSchema(TEMPLATE_SCHEMA)

  test('has a required layer for every table of the template', () => {
    expect(schema.layers.map((layer) => layer.tableName)).toEqual(
      TEMPLATE_SCHEMA.tables.map((table) => table.name)
    )
    expect(schema.layers.every((layer) => layer.required)).toBe(true)
  })

  test('gives each layer its geometry, spatial reference and columns', () => {
    const layer = schema.layers.find(
      (candidate) => candidate.tableName === 'Area Habitats Baseline'
    )

    expect(layer).toMatchObject({
      dataType: 'features',
      srsId: 27700,
      geometryColumn: { name: 'geom', geometryType: 'POLYGON' }
    })
    expect(layer.columns.slice(0, 3)).toEqual([
      { name: 'fid', sqliteType: 'INTEGER', notNull: true, primaryKey: true },
      {
        name: 'geom',
        sqliteType: 'POLYGON',
        notNull: false,
        primaryKey: false
      },
      {
        name: 'Habitat Ref',
        sqliteType: 'TEXT',
        notNull: false,
        primaryKey: false
      }
    ])
  })
})
