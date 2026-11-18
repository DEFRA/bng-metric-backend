import path from 'node:path'
import Joi from 'joi'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  STAGE_BASELINE,
  STAGE_POST_INTERVENTION,
  TEMPLATE_SCHEMA
} from 'bng-library/bng-service'

import { config } from '../config.js'
import { importUploadFile } from '../services/upload/import-upload-file.js'
import { PROP_KEYS, TREE_ADVANCE_DELAY_KEYS } from './geopackage/properties.js'
import { TEMPLATE_MAPPING_1_0 } from './geopackage/service-template/template-mapping.js'
import { projectSchema } from './project.js'
import {
  BNG_SERVICE_ONLY,
  LEGACY_ONLY,
  TEMPLATES,
  templateOf
} from './template-applicability.js'

const FIXTURES = path.resolve(
  import.meta.dirname,
  '../../integration-tests/fixtures'
)
const BASELINE = { projectDocumentKey: 'baseline' }
const POST_INTERVENTION = { projectDocumentKey: 'postIntervention' }
const IMPORT_TIMEOUT_MS = 60_000

describe('templateOf', () => {
  const describedWith = (meta) => {
    const schema = Joi.string()
    return (meta ? schema.meta(meta) : schema).describe()
  }

  it('reads a field as filled by either template when it is not tagged', () => {
    expect(templateOf(describedWith())).toBe(TEMPLATES.BOTH)
  })

  it('reads a field’s own tag', () => {
    expect(templateOf(describedWith(BNG_SERVICE_ONLY))).toBe(
      TEMPLATES.BNG_SERVICE
    )
    expect(templateOf(describedWith(LEGACY_ONLY))).toBe(TEMPLATES.LEGACY)
  })

  it('gives an untagged field the tag of the field it sits under', () => {
    expect(templateOf(describedWith(), TEMPLATES.BNG_SERVICE)).toBe(
      TEMPLATES.BNG_SERVICE
    )
  })

  it('reads a legacy field under a BNG Service one as filled by neither', () => {
    expect(templateOf(describedWith(LEGACY_ONLY), TEMPLATES.BNG_SERVICE)).toBe(
      TEMPLATES.NEITHER
    )
  })
})

/** Every schema path, as the data dictionary names it, with its template. */
function schemaTemplates(node, pathSoFar = '', inherited, out = new Map()) {
  const template = templateOf(node, inherited)
  if (pathSoFar) {
    out.set(pathSoFar, template)
  }
  if (node.type === 'object' && node.keys) {
    for (const [key, child] of Object.entries(node.keys)) {
      schemaTemplates(
        child,
        pathSoFar ? `${pathSoFar}.${key}` : key,
        template,
        out
      )
    }
  } else if (node.type === 'array' && node.items?.[0]) {
    schemaTemplates(node.items[0], `${pathSoFar}[]`, template, out)
  }
  return out
}

// A legacy upload writes an empty list and a zero total for the vertical area
// habitats it cannot have, so nothing counts as filled.
const isEmpty = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  value === 0 ||
  (Array.isArray(value) && value.length === 0)

/** The schema paths a document fills, at any depth. */
function filledPaths(value, pathSoFar = '', out = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => filledPaths(item, `${pathSoFar}[]`, out))
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      filledPaths(child, pathSoFar ? `${pathSoFar}.${key}` : key, out)
    }
  } else if (!isEmpty(value)) {
    out.add(pathSoFar)
  }
  return out
}

function withServiceTemplate(enabled) {
  let flagAsSet
  beforeAll(() => {
    flagAsSet = config.get('serviceTemplate.enabled')
    config.set('serviceTemplate.enabled', enabled)
  })
  afterAll(() => config.set('serviceTemplate.enabled', flagAsSet))
}

const TEMPLATES_BY_PATH = schemaTemplates(projectSchema.describe())

/** The filled paths whose template is not one of `fillableBy`. */
const filledAgainstTag = (project, fillableBy) =>
  [...filledPaths(project)].filter((filled) => {
    const template = TEMPLATES_BY_PATH.get(filled)
    return template !== undefined && !fillableBy.includes(template)
  })

// The data dictionary and the warehouse ERD tell downstream consumers which
// fields a document from each template has (BMD-1085): a field tagged for one
// template must never be filled by an upload of the other.
describe('the template each project document field is tagged with', () => {
  describe('a legacy upload', () => {
    withServiceTemplate(false)

    it(
      'fills no field tagged BNG Service or neither',
      async () => {
        const baseline = await importUploadFile(
          path.join(FIXTURES, 'baseline-complete.gpkg'),
          {},
          BASELINE
        )
        const both = await importUploadFile(
          path.join(FIXTURES, 'post-intervention-combined.gpkg'),
          baseline.project,
          POST_INTERVENTION
        )

        expect(both.accepted).toBe(true)
        expect(
          filledAgainstTag(both.project, [TEMPLATES.BOTH, TEMPLATES.LEGACY])
        ).toEqual([])
      },
      IMPORT_TIMEOUT_MS
    )
  })

  describe('a BNG Service template upload', () => {
    withServiceTemplate(true)

    it(
      'fills no field tagged legacy or neither',
      async () => {
        const result = await importUploadFile(
          path.join(FIXTURES, 'service-template', 'default-site.gpkg'),
          {},
          POST_INTERVENTION
        )

        expect(result.accepted).toBe(true)
        expect(
          filledAgainstTag(result.project, [
            TEMPLATES.BOTH,
            TEMPLATES.BNG_SERVICE
          ])
        ).toEqual([])
      },
      IMPORT_TIMEOUT_MS
    )
  })
})

// The upload test above shows only what its fixture fills. These say the
// legacy-only tags hold for any BNG Service template file: the columns the
// tagged fields are read from are not ones the template's tables have, or the
// service does not read them. A template that gains one fails here, and the
// tag must then be reconsidered.
describe('the legacy-only fields a BNG Service template file has no column for', () => {
  const STAGES = [STAGE_BASELINE, STAGE_POST_INTERVENTION]

  /** The names the pipeline reads a template table's columns by. */
  const readNames = (layer, stage) => {
    const { table, columns } = TEMPLATE_MAPPING_1_0[layer]
    const name = table(stage)
    return TEMPLATE_SCHEMA.tables
      .find((candidate) => candidate.name === name)
      .columns.map((column) => columns.get(column.name))
      .filter((readAs) => readAs !== null && readAs !== undefined)
  }

  const HABITAT_LAYERS = [
    'areas',
    'verticalHabitats',
    'hedgerows',
    'watercourses',
    'trees'
  ]

  // Each Baseline table: the survey metadata, spatial risk, raw
  // distinctiveness, retention category and advance and delay years tagged
  // legacy on a baseline feature.
  const BASELINE_LEGACY_COLUMNS = [
    PROP_KEYS.siteName,
    PROP_KEYS.surveyDate,
    PROP_KEYS.surveyDetails,
    PROP_KEYS.mappedBy,
    PROP_KEYS.company,
    PROP_KEYS.baseMap,
    PROP_KEYS.location,
    PROP_KEYS.spatialRiskCategory,
    PROP_KEYS.baselineDistinctiveness,
    PROP_KEYS.retentionCategory,
    PROP_KEYS.habitatCreatedInAdvanceYears,
    PROP_KEYS.delayInStartingHabitatCreationYears,
    TREE_ADVANCE_DELAY_KEYS.advanceYears,
    TREE_ADVANCE_DELAY_KEYS.delayYears
  ].flat()

  it.each(HABITAT_LAYERS)(
    'reads none of them from the %s Baseline table',
    (layer) => {
      expect(
        readNames(layer, STAGE_BASELINE).filter((name) =>
          BASELINE_LEGACY_COLUMNS.includes(name)
        )
      ).toEqual([])
    }
  )

  it.each(STAGES)('reads no tree Count at the %s stage', (stage) => {
    expect(readNames('trees', stage)).not.toContain(PROP_KEYS.treeCount[0])
  })

  it.each(STAGES)(
    'reads no Site Name or Area from the Red Line Boundary at the %s stage',
    (stage) => {
      expect(readNames('redline', stage)).toEqual([])
    }
  )
})
