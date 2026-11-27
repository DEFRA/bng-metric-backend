import {
  GEOMETRY_COLUMN,
  GPKG_SPEC,
  RED_LINE_BOUNDARY
} from 'bng-library/bng-service'

import { templateMappingSources } from '../../../../scripts/gen-template-mapping.js'
import {
  TEMPLATE_COLUMN_USES_1_0,
  USE,
  USED_BY
} from './template-column-uses.js'
import { buildTemplateFieldMapping } from './template-field-mapping.js'
import {
  PRIMARY_KEY,
  READ_AS_GEOMETRY,
  TEMPLATE_MAPPING_1_0
} from './template-mapping.js'

const SOURCES = templateMappingSources()

const AREA_BASELINE = 'Area Habitats Baseline'
const NEW_COLUMN = 'Survey Method'

/** A row of the mapping, by table and column. */
function rowOf(table, column) {
  return buildTemplateFieldMapping(SOURCES).rows.find(
    (row) => row.table === table && row.column === column
  )
}

/** The specification with one more column on a table. */
function withColumn(table, column) {
  return {
    ...GPKG_SPEC,
    tables: GPKG_SPEC.tables.map((entry) =>
      entry.name === table
        ? {
            ...entry,
            columns: [...entry.columns, { name: column, type: 'TEXT' }]
          }
        : entry
    )
  }
}

/** The uses with one column's entry replaced. */
function withUse(layer, column, use) {
  return {
    ...TEMPLATE_COLUMN_USES_1_0,
    [layer]: { ...TEMPLATE_COLUMN_USES_1_0[layer], [column]: use }
  }
}

describe('the BNG Service template 1.0 field mapping', () => {
  test('accounts for every column of the template, with nothing left over', () => {
    const { problems } = buildTemplateFieldMapping(SOURCES)

    expect(problems).toEqual([])
  })

  test('has a row for every column the GeoPackage specification lists, at its stage', () => {
    const { rows } = buildTemplateFieldMapping(SOURCES)

    const expected = GPKG_SPEC.tables.flatMap(({ name, columns }) =>
      columns.map((column) => `${name} / ${column.name}`)
    )
    expect(rows.map(({ table, column }) => `${table} / ${column}`)).toEqual(
      expected
    )
  })

  test('gives every row a use, and only known uses', () => {
    const { rows } = buildTemplateFieldMapping(SOURCES)
    const uses = Object.values(USE)
    const usedBy = Object.values(USED_BY)

    for (const row of rows) {
      expect(uses).toContain(row.use)
      for (const by of row.usedBy) {
        expect(usedBy).toContain(by)
      }
    }
  })

  test('says what uses every column it uses', () => {
    const { rows } = buildTemplateFieldMapping(SOURCES)

    const unexplained = rows.filter(
      (row) => row.use !== USE.IGNORED && row.usedBy.length === 0 && !row.note
    )
    expect(unexplained).toEqual([])
  })

  test('stores a column the reader reads in the feature’s properties, under its own name', () => {
    const { rows } = buildTemplateFieldMapping(SOURCES)
    const row = rows.find(
      (entry) =>
        entry.table === 'Hedgerows Post-Intervention' &&
        entry.column === 'Habitat Ref'
    )

    expect(row.storedFields).toEqual([
      'postIntervention.hedgerows[].ref',
      'postIntervention.hedgerows[].properties["Habitat Ref"]'
    ])
  })

  test('maps the primary key and the geometry of every table, which the column mapping leaves to the reader', () => {
    const { rows } = buildTemplateFieldMapping(SOURCES)

    for (const { name, geometryColumn } of GPKG_SPEC.tables) {
      const columns = rows.filter((row) => row.table === name)
      expect(columns.find((row) => row.column === PRIMARY_KEY).readAs).toBe(
        PRIMARY_KEY
      )
      expect(columns.find((row) => row.column === geometryColumn).readAs).toBe(
        READ_AS_GEOMETRY
      )
    }
  })

  test('stores the geometry in the layer’s PostGIS table, not the document', () => {
    expect(
      rowOf('Hedgerows Post-Intervention', GEOMETRY_COLUMN).storedFields
    ).toEqual(['bng.post_intervention_hedgerows.geom'])
  })

  test('keeps the primary key in the feature’s properties', () => {
    expect(rowOf(AREA_BASELINE, PRIMARY_KEY).storedFields).toEqual([
      'baseline.habitats[].properties["fid"]'
    ])
  })

  test('stores the Red Line Boundary at both stages, which each read its one table', () => {
    expect(rowOf(RED_LINE_BOUNDARY, GEOMETRY_COLUMN).storedFields).toEqual([
      'bng.baseline_red_line.geom',
      'bng.post_intervention_red_line.geom'
    ])
    expect(rowOf(RED_LINE_BOUNDARY, PRIMARY_KEY).storedFields).toEqual([
      'baseline.redLine.properties["fid"]',
      'postIntervention.redLine.properties["fid"]'
    ])
  })

  test('stores a dropped column nowhere', () => {
    const { rows } = buildTemplateFieldMapping(SOURCES)
    const dropped = rows.filter((row) => row.readAs === null)

    expect(dropped.length).toBeGreaterThan(0)
    for (const row of dropped) {
      expect(row.use).toBe(USE.IGNORED)
      expect(row.storedFields).toEqual([])
    }
  })

  test('is the same from the same sources', () => {
    expect(JSON.stringify(buildTemplateFieldMapping(SOURCES))).toBe(
      JSON.stringify(buildTemplateFieldMapping(SOURCES))
    )
  })

  describe('fails, naming the column', () => {
    test('when a template column has no mapping in the reader', () => {
      const { problems } = buildTemplateFieldMapping({
        ...SOURCES,
        spec: withColumn(AREA_BASELINE, NEW_COLUMN)
      })

      expect(problems).toEqual([
        `${AREA_BASELINE} / ${NEW_COLUMN}: no mapping in the reader`
      ])
    })

    test('when a template column has no use', () => {
      const columns = new Map([
        ...TEMPLATE_MAPPING_1_0.areas.columns,
        [NEW_COLUMN, NEW_COLUMN]
      ])
      const { problems } = buildTemplateFieldMapping({
        ...SOURCES,
        spec: withColumn(AREA_BASELINE, NEW_COLUMN),
        mapping: {
          ...TEMPLATE_MAPPING_1_0,
          areas: { ...TEMPLATE_MAPPING_1_0.areas, columns }
        }
      })

      expect(problems).toEqual([
        `${AREA_BASELINE} / ${NEW_COLUMN}: no use in template-column-uses.js`
      ])
    })

    test('when a use names a column the template does not have', () => {
      const { problems } = buildTemplateFieldMapping({
        ...SOURCES,
        uses: withUse(
          'hedgerows',
          NEW_COLUMN,
          TEMPLATE_COLUMN_USES_1_0.hedgerows.Length
        )
      })

      expect(problems).toEqual([
        `hedgerows / ${NEW_COLUMN}: a use for a column no hedgerows table has`
      ])
    })

    test('when a column the reader drops is said to be used', () => {
      const { problems } = buildTemplateFieldMapping({
        ...SOURCES,
        uses: withUse(
          'hedgerows',
          'Length',
          TEMPLATE_COLUMN_USES_1_0.hedgerows.Comment
        )
      })

      expect(problems).toContain(
        'Hedgerows Baseline / Length: the reader drops it, so it must be ignored, not used'
      )
    })

    test('when the primary key or the geometry has no use', () => {
      const { [PRIMARY_KEY]: fid, ...trees } = TEMPLATE_COLUMN_USES_1_0.trees
      const { problems } = buildTemplateFieldMapping({
        ...SOURCES,
        uses: { ...TEMPLATE_COLUMN_USES_1_0, trees }
      })

      expect(fid).toBeDefined()
      expect(problems).toEqual([
        `Individual Trees Baseline / ${PRIMARY_KEY}: no use in template-column-uses.js`,
        `Individual Trees Post-Intervention / ${PRIMARY_KEY}: no use in template-column-uses.js`
      ])
    })

    test('when a stored field is not in the data dictionary', () => {
      const { problems } = buildTemplateFieldMapping({
        ...SOURCES,
        uses: withUse('trees', 'Comment', {
          ...TEMPLATE_COLUMN_USES_1_0.trees.Comment,
          baseline: ['remark']
        })
      })

      expect(problems).toEqual([
        'Individual Trees Baseline / Comment: baseline.trees[].remark is not in the data dictionary'
      ])
    })
  })
})
