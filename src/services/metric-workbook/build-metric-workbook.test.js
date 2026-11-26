import { createHash } from 'node:crypto'

import { describe, expect, test } from 'vitest'

import { zipEntries } from '../../../test/helpers/zip-entries.js'
import {
  METRIC_FORMATS,
  buildMetricWorkbook,
  metricTemplate
} from './build-metric-workbook.js'

// Writing into the real templates, several MB of XML each, takes about a
// second; a slow CI runner gets room.
const WRITE_TIMEOUT_MS = 30_000
const MACROS_PART = 'xl/vbaProject.bin'
const WORKBOOK_PART = 'xl/workbook.xml'
const CONTENT_TYPES_PART = '[Content_Types].xml'
const SHEET_PART = /^xl\/worksheets\/sheet\d+\.xml$/

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const project = {
  name: 'Riverside Farm',
  details: {
    localPlanningAuthority: 'Riverside District Council',
    applicant: 'Riverside Homes Ltd',
    planningApplicationType: 'Outline',
    planningApplicationReference: 'RDC/24/0001'
  },
  baseline: {
    habitats: [
      {
        featureId: 'b1',
        ref: 'H-TEST-1',
        broadType: 'Grassland',
        type: 'Modified grassland',
        condition: 'Poor',
        strategicSignificance: 'Low',
        sizeSquareMetres: 15_000
      }
    ]
  }
}

function sheetParts(entries) {
  return [...entries.keys()].filter((name) => SHEET_PART.test(name))
}

const text = (entries, name) => entries.get(name).toString('utf8')

/** Every sheet's sheet protection element, by part. */
function protections(entries) {
  return sheetParts(entries).map((name) => [
    name,
    /<sheetProtection\b[^>]*>/.exec(text(entries, name))?.[0] ?? null
  ])
}

/** Every sheet's formulas, by part: the text of each <f> element. */
function formulas(entries) {
  return sheetParts(entries).map((name) => [
    name,
    [...text(entries, name).matchAll(/<f\b[^>]*>([^<]*)<\/f>/g)].map(
      (m) => m[0]
    )
  ])
}

describe('the committed metric templates', () => {
  test.each(Object.entries(METRIC_FORMATS))(
    'the %s template is release 1.1.1 exactly as GOV.UK serves it',
    async (format, { sha256: expected }) => {
      expect(sha256(await metricTemplate(format))).toBe(expected)
    }
  )
})

describe('buildMetricWorkbook', () => {
  test(
    'keeps the macro-enabled template’s macros, byte for byte',
    async () => {
      const template = zipEntries(await metricTemplate('xlsm'))
      const written = zipEntries(
        await buildMetricWorkbook(project, { format: 'xlsm' })
      )

      expect(written.get(MACROS_PART)).toEqual(template.get(MACROS_PART))
      expect(text(written, CONTENT_TYPES_PART)).toContain(
        'application/vnd.ms-excel.sheet.macroEnabled.main+xml'
      )
    },
    WRITE_TIMEOUT_MS
  )

  test(
    'gives the macro-free workbook no macros',
    async () => {
      const written = zipEntries(
        await buildMetricWorkbook(project, { format: 'xlsx' })
      )

      expect(written.has(MACROS_PART)).toBe(false)
    },
    WRITE_TIMEOUT_MS
  )

  test.each(Object.keys(METRIC_FORMATS))(
    'leaves the %s template’s formulas and sheet protection as published, and recalculates on open',
    async (format) => {
      const template = zipEntries(await metricTemplate(format))
      const written = zipEntries(await buildMetricWorkbook(project, { format }))

      expect(protections(written)).toEqual(protections(template))
      expect(formulas(written)).toEqual(formulas(template))
      expect(text(written, WORKBOOK_PART)).toMatch(
        /<calcPr\b[^>]*fullCalcOnLoad="1"/
      )
    },
    WRITE_TIMEOUT_MS
  )

  test(
    'writes the features and the project details into a copy, never into the template',
    async () => {
      const before = sha256(await metricTemplate('xlsx'))
      const written = zipEntries(
        await buildMetricWorkbook(project, { format: 'xlsx' })
      )
      const sheets = sheetParts(written)
        .map((name) => text(written, name))
        .join('')

      for (const value of [
        'H-TEST-1',
        'Modified grassland',
        'Riverside Farm',
        'Riverside District Council',
        'Riverside Homes Ltd',
        'Outline',
        'RDC/24/0001'
      ]) {
        expect(sheets, value).toContain(`>${value}</t>`)
      }
      expect(sha256(await metricTemplate('xlsx'))).toBe(before)
    },
    WRITE_TIMEOUT_MS
  )

  test(
    'still downloads a project with an Enhanced feature that has no size yet',
    async () => {
      // A legacy feature is enhanced by its baseline size, so it is that
      // which is missing.
      const incomplete = {
        ...project,
        baseline: {
          habitats: [
            { ...project.baseline.habitats[0], sizeSquareMetres: null }
          ]
        },
        postIntervention: {
          habitats: [
            {
              ref: 'H-TEST-1',
              retentionCategory: 'Enhanced',
              sizeSquareMetres: null,
              proposed: { condition: 'Good' }
            }
          ]
        }
      }

      await expect(
        buildMetricWorkbook(incomplete, { format: 'xlsx' })
      ).resolves.toBeInstanceOf(Buffer)
    },
    WRITE_TIMEOUT_MS
  )

  test('refuses a format it has no template for', async () => {
    await expect(
      buildMetricWorkbook(project, { format: 'xls' })
    ).rejects.toThrow('Unknown metric format: xls')
  })
})
