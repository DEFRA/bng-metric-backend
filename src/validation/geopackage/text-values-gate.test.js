import { TEMPLATE_SCHEMA } from 'bng-library/bng-service'

import { config } from '../../config.js'
import { ERROR_CODES } from './errors.js'
import { runFormatGate } from './format-gate.js'
import { EXTRACT_VARIANT } from './properties.js'
import {
  LONG_TEXT_LIMIT,
  SHORT_TEXT_LIMIT,
  SPATIAL_RISK_LIMIT,
  TRUNCATION_MARKER,
  allowedValuesOf,
  shownValue,
  textLimitOf
} from './text-limits.js'
import {
  buildServiceTemplateBuffer,
  populatedPostInterventionRows
} from '../../../test/helpers/service-template-gpkg.js'
import {
  fullReadBuffer,
  mutateSerializedBuffer,
  withTempGpkgFile
} from '../../../test/helpers/gpkg.js'

const AREA_BASELINE = 'Area Habitats Baseline'
const AREA_PI = 'Area Habitats Post-Intervention'
const RED_LINE = 'Red Line Boundary'
const UUID = 'de9d1450-90f7-584a-9710-edf7ec189de4'

const codes = (result) => result.errors.map((error) => error.code)

/**
 * The gate at the baseline + post-intervention endpoint, over a template file
 * whose only rows are `rows`, plus one post-intervention row so the file
 * describes a post-intervention stage.
 */
function templateGate(rows, documentKey = EXTRACT_VARIANT.POST_INTERVENTION) {
  const all = { [AREA_PI]: [{ 'Habitat Ref': 'P1' }], ...rows }
  return withTempGpkgFile(buildServiceTemplateBuffer({ rows: all }), (file) =>
    runFormatGate(file, documentKey)
  )
}

function oneValue(table, column, value) {
  const ref = table === RED_LINE ? {} : { 'Habitat Ref': 'H-12' }
  return templateGate({ [table]: [{ ...ref, [column]: value }] })
}

/** Every template table and column with a limit, as [table, column, limit]. */
const LIMITED_COLUMNS = TEMPLATE_SCHEMA.tables.flatMap((table) =>
  table.columns
    .map((column) => [table.name, column.name, textLimitOf(column.name)])
    .filter(([, , limit]) => limit !== null)
)

/** Every habitat table's drop-down and filled-in column, as [table, column]. */
const LISTED_COLUMNS = TEMPLATE_SCHEMA.tables
  .filter((table) => table.name !== RED_LINE)
  .flatMap((table) =>
    table.columns
      .filter((column) => allowedValuesOf(column.name) !== null)
      .map((column) => [table.name, column.name])
  )

describe('text-values-gate', () => {
  const flagAsSet = config.get('serviceTemplate.enabled')

  afterEach(() => {
    config.set('serviceTemplate.enabled', flagAsSet)
  })

  describe('a BNG Service template file', () => {
    beforeEach(() => {
      config.set('serviceTemplate.enabled', true)
    })

    test('limits every text column but the lineage columns', () => {
      const unlimited = TEMPLATE_SCHEMA.tables.flatMap((table) =>
        table.columns
          .filter((column) => column.type.startsWith('TEXT'))
          .filter((column) => textLimitOf(column.name) === null)
          .map((column) => column.name)
      )
      expect([...new Set(unlimited)].sort()).toEqual([
        'feature_uuid',
        'parent_geom',
        'parent_uuid'
      ])
    })

    test('limits each column to the width the template declares', () => {
      for (const [table, column, limit] of LIMITED_COLUMNS) {
        const declared = TEMPLATE_SCHEMA.tables
          .find((t) => t.name === table)
          .columns.find((c) => c.name === column).type
        expect([table, column, declared]).toEqual([
          table,
          column,
          `TEXT(${limit})`
        ])
      }
    })

    test.each(LIMITED_COLUMNS)(
      '%s: %s passes the length check at %i characters and fails it one over',
      async (table, column, limit) => {
        const atLimit = await oneValue(table, column, 'a'.repeat(limit))
        expect(codes(atLimit)).not.toContain(ERROR_CODES.TEXT_TOO_LONG)

        const over = await oneValue(table, column, 'a'.repeat(limit + 1))
        expect(codes(over)).toEqual([ERROR_CODES.TEXT_TOO_LONG])
      }
    )

    test('counts characters, not bytes, so accented and emoji text at the limit passes', async () => {
      const result = await templateGate({
        [AREA_BASELINE]: [
          {
            'Habitat Ref': 'é'.repeat(SHORT_TEXT_LIMIT),
            Comment: '🌳'.repeat(LONG_TEXT_LIMIT)
          }
        ]
      })
      expect(result.valid).toBe(true)

      const over = await templateGate({
        [AREA_BASELINE]: [{ Comment: '🌳'.repeat(LONG_TEXT_LIMIT + 1) }]
      })
      expect(codes(over)).toEqual([ERROR_CODES.TEXT_TOO_LONG])
    })

    test('measures a value once the whitespace at its ends is removed', async () => {
      const result = await oneValue(
        AREA_BASELINE,
        'Comment',
        `\n  ${'a'.repeat(LONG_TEXT_LIMIT)}  `
      )
      expect(result.valid).toBe(true)
    })

    test('names the table, the feature, the column, the limit and the length', async () => {
      const result = await oneValue(AREA_BASELINE, 'Comment', 'a'.repeat(1240))
      expect(result.errors).toEqual([
        {
          code: ERROR_CODES.TEXT_TOO_LONG,
          message:
            'Area Habitats Baseline, H-12: Comment has 1,240 characters. The maximum is 999.',
          details: {
            table: AREA_BASELINE,
            fid: 1,
            column: 'Comment',
            limit: LONG_TEXT_LIMIT,
            length: 1240
          }
        }
      ])
    })

    test('names the row where the reference itself is too long', async () => {
      const result = await templateGate({
        [AREA_BASELINE]: [{ 'Habitat Ref': 'R'.repeat(SHORT_TEXT_LIMIT + 1) }]
      })
      expect(result.errors[0].message).toBe(
        'Area Habitats Baseline, row 1: Habitat Ref has 100 characters. The maximum is 99.'
      )
    })

    test('refuses a long drop-down value by its length, before it is looked up', async () => {
      const result = await oneValue(
        AREA_BASELINE,
        'Baseline Condition',
        'x'.repeat(100_000)
      )
      expect(codes(result)).toEqual([ERROR_CODES.TEXT_TOO_LONG])
      expect(result.errors[0].message).not.toContain('x'.repeat(100))
    })

    test('checks the Red Line Boundary details', async () => {
      const result = await templateGate({
        [RED_LINE]: [
          {
            'Site Name': 's'.repeat(LONG_TEXT_LIMIT + 1),
            Location: 'l'.repeat(SHORT_TEXT_LIMIT + 1)
          }
        ]
      })
      expect(result.errors.map((error) => error.message)).toEqual([
        'Red Line Boundary, row 1: Site Name has 1,000 characters. The maximum is 999.',
        'Red Line Boundary, row 1: Location has 100 characters. The maximum is 99.'
      ])
    })

    test('lets Spatial risk category hold its longest value, of 115 characters', async () => {
      const longest =
        'Intertidal habitats - Compensation outside Marine Plan Area of impact site and beyond neighbouring Marine Plan Area'
      const result = await oneValue(AREA_PI, 'Spatial risk category', longest)
      expect(result.valid).toBe(true)
      expect(textLimitOf('Spatial risk category')).toBe(SPATIAL_RISK_LIMIT)
    })

    test.each(LISTED_COLUMNS)(
      '%s: %s refuses a value that is not in its list',
      async (table, column) => {
        const result = await oneValue(table, column, 'Not a template value')
        expect(result.errors).toEqual([
          expect.objectContaining({
            code: ERROR_CODES.VALUE_NOT_ALLOWED,
            message: `${table}, H-12: ${column} has "Not a template value", which is not in its list.`
          })
        ])
      }
    )

    test('accepts a blank value, a list number and a value in another case', async () => {
      const result = await templateGate({
        [AREA_BASELINE]: [
          { 'Baseline Condition': null, 'Baseline Habitat Type': '  ' },
          { 'Baseline Condition': ' \t\n ', feature_uuid: '\t' },
          { 'Baseline Condition': '4. Fairly Poor' },
          { 'Baseline Condition': 'fairly  poor' }
        ]
      })
      expect(result.valid).toBe(true)
    })

    test('accepts years written as a number, or as a whole decimal', async () => {
      const result = await templateGate({
        [AREA_PI]: [
          { 'Habitat created in advance/years': 5 },
          { 'Habitat created in advance/years': '5.0' },
          { 'Delay in starting habitat creation/years': '30+' },
          // In a list under a column name with a trailing space, as the
          // legacy template spells one timing column.
          {
            'Habitat created in advance/years':
              'Habitat already in target condition'
          }
        ]
      })
      expect(result.valid).toBe(true)
    })

    test('shows a refused value cut to 99 characters, marked as truncated', async () => {
      const value = 'r'.repeat(200)
      const result = await oneValue(AREA_PI, 'Spatial risk category', value)
      const [error] = result.errors
      expect(error.code).toBe(ERROR_CODES.VALUE_NOT_ALLOWED)
      expect(error.message).toContain(
        `"${'r'.repeat(SHORT_TEXT_LIMIT)}${TRUNCATION_MARKER}"`
      )
      expect(error.message).not.toContain('r'.repeat(SHORT_TEXT_LIMIT + 1))
    })

    test('leaves the free-text Location of the Red Line Boundary unchecked against a list', async () => {
      const result = await templateGate({
        [RED_LINE]: [{ Location: 'Land north of Mill Lane' }]
      })
      expect(result.valid).toBe(true)
    })

    test('refuses a feature_uuid or parent_uuid that is not a UUID', async () => {
      const result = await templateGate({
        [AREA_BASELINE]: [
          { 'Habitat Ref': 'H1', feature_uuid: UUID },
          { 'Habitat Ref': 'H2', feature_uuid: 'not-a-uuid' }
        ],
        [AREA_PI]: [
          { 'Habitat Ref': 'P1', parent_uuid: `{${UUID}}` },
          { 'Habitat Ref': 'P2', parent_uuid: 'u'.repeat(100_000) }
        ]
      })
      expect(result.errors.map((error) => error.message)).toEqual([
        'Area Habitats Baseline, H2: feature_uuid is not a valid UUID.',
        'Area Habitats Post-Intervention, P1: parent_uuid is not a valid UUID.',
        'Area Habitats Post-Intervention, P2: parent_uuid is not a valid UUID.'
      ])
      expect(codes(result)).toEqual([
        ERROR_CODES.FEATURE_UUID_INVALID,
        ERROR_CODES.PARENT_UUID_INVALID,
        ERROR_CODES.PARENT_UUID_INVALID
      ])
    })

    test("refuses a parent_geom that is not WKT of the table's shape", async () => {
      const result = await templateGate({
        [AREA_PI]: [
          {
            'Habitat Ref': 'P1',
            parent_geom: 'Polygon ((0 0, 1 0, 1 1, 0 0))'
          },
          {
            'Habitat Ref': 'P2',
            parent_geom: 'MultiPolygon (((0 0, 1 0, 1 1, 0 0)))'
          },
          { 'Habitat Ref': 'P3', parent_geom: 'LineString (0 0, 1 1)' },
          { 'Habitat Ref': 'P4', parent_geom: 'Polygon ((0 0, 1 0' },
          { 'Habitat Ref': 'P5', parent_geom: '' }
        ]
      })
      expect(codes(result)).toEqual([
        ERROR_CODES.PARENT_GEOM_INVALID,
        ERROR_CODES.PARENT_GEOM_INVALID
      ])
      expect(result.errors.map((error) => error.details.fid)).toEqual([3, 4])
    })

    test('at the baseline endpoint, checks only the tables that endpoint reads', async () => {
      const result = await withTempGpkgFile(
        buildServiceTemplateBuffer({
          rows: { [AREA_PI]: [{ Comment: 'a'.repeat(LONG_TEXT_LIMIT + 1) }] }
        }),
        (file) => runFormatGate(file, EXTRACT_VARIANT.BASELINE)
      )
      expect(result.valid).toBe(true)
    })

    test('passes the populated template rows unchanged', async () => {
      const result = await templateGate(populatedPostInterventionRows())
      expect(result.valid).toBe(true)
    })

    test('passes a 1.0 file whose text columns are declared as plain TEXT', async () => {
      const columnTypes = Object.fromEntries(
        TEMPLATE_SCHEMA.tables.map((table) => [
          table.name,
          Object.fromEntries(
            table.columns
              .filter((column) => column.type.startsWith('TEXT'))
              .map((column) => [column.name, 'TEXT'])
          )
        ])
      )
      const result = await withTempGpkgFile(
        buildServiceTemplateBuffer({
          columnTypes,
          rows: populatedPostInterventionRows()
        }),
        (file) => runFormatGate(file, EXTRACT_VARIANT.POST_INTERVENTION)
      )
      expect(result.valid).toBe(true)
    })

    test('reports at most 50 values, then counts the rest', async () => {
      const rows = Array.from({ length: 60 }, (_, i) => ({
        'Habitat Ref': `H${i}`,
        Comment: 'a'.repeat(LONG_TEXT_LIMIT + 1)
      }))
      const result = await templateGate({ [AREA_BASELINE]: rows })
      expect(result.errors).toHaveLength(51)
      expect(result.errors[50].message).toBe(
        '10 more values have a problem of this kind.'
      )
    })
  })

  describe('a legacy file', () => {
    beforeEach(() => {
      config.set('serviceTemplate.enabled', false)
    })

    function legacyGate(mutate) {
      return withTempGpkgFile(
        mutateSerializedBuffer(fullReadBuffer(), mutate),
        (file) => runFormatGate(file, EXTRACT_VARIANT.BASELINE)
      )
    }

    test('passes as before', async () => {
      expect((await legacyGate(() => {})).valid).toBe(true)
    })

    test.each([
      ['Habitats', 'Parcel Ref', SHORT_TEXT_LIMIT],
      ['Urban Trees', 'Tree Ref', SHORT_TEXT_LIMIT],
      ['Hedgerows', 'Comments', LONG_TEXT_LIMIT],
      ['Habitats', 'Comment', LONG_TEXT_LIMIT],
      ['Red Line Boundary', 'Site Name', LONG_TEXT_LIMIT]
    ])(
      '%s: %s, under its own name, has the same limit',
      async (table, column, limit) => {
        const atLimit = await legacyGate((db) =>
          db
            .prepare(`UPDATE "${table}" SET "${column}" = ?`)
            .run('a'.repeat(limit))
        )
        expect(codes(atLimit)).not.toContain(ERROR_CODES.TEXT_TOO_LONG)

        const over = await legacyGate((db) =>
          db
            .prepare(`UPDATE "${table}" SET "${column}" = ?`)
            .run('a'.repeat(limit + 1))
        )
        expect(codes(over)).toContain(ERROR_CODES.TEXT_TOO_LONG)
        expect(new Set(codes(over))).toEqual(
          new Set([ERROR_CODES.TEXT_TOO_LONG])
        )
      }
    )

    test('refuses a value that no list offers, and accepts a numbered legacy label', async () => {
      const refused = await legacyGate((db) =>
        db
          .prepare('UPDATE "Habitats" SET "Baseline Condition" = ?')
          .run('Splendid')
      )
      expect(codes(refused)).toContain(ERROR_CODES.VALUE_NOT_ALLOWED)

      const numbered = await legacyGate((db) =>
        db
          .prepare('UPDATE "Habitats" SET "Baseline Condition" = ?')
          .run('2. Fairly Good')
      )
      expect(numbered.valid).toBe(true)
    })
  })
})

describe('shownValue', () => {
  test('keeps a value of up to 99 characters whole', () => {
    expect(shownValue('é'.repeat(SHORT_TEXT_LIMIT))).toBe(
      'é'.repeat(SHORT_TEXT_LIMIT)
    )
  })

  test('cuts a longer one to 99 characters, never splitting one, and marks it', () => {
    expect(shownValue('🌳'.repeat(SHORT_TEXT_LIMIT + 1))).toBe(
      `${'🌳'.repeat(SHORT_TEXT_LIMIT)}${TRUNCATION_MARKER}`
    )
  })

  test('shows a missing value as empty text', () => {
    expect(shownValue(null)).toBe('')
  })
})
