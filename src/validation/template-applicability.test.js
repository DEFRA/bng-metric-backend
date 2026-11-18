import path from 'node:path'
import Joi from 'joi'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { config } from '../config.js'
import { importUploadFile } from '../services/upload/import-upload-file.js'
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
