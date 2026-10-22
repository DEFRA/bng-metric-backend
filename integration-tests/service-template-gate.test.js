import { expect, it } from 'vitest'

import { describeServiceTemplate } from '../test/helpers/template-mode.js'
import { ERROR_CODES } from '../src/validation/geopackage/errors.js'
import { HTTP_OK } from './helpers/http-status.js'
import {
  FIXTURE as LEGACY_FIXTURE,
  callPostInterventionValidate,
  callValidate,
  createProject,
  fetchProject,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()

const ENDPOINTS = [
  ['baseline', callValidate],
  ['baseline + post-intervention', callPostInterventionValidate]
]

/** What each file is refused with, and why. */
const REFUSALS = [
  [
    'a file with no version record',
    'service-template/version-record-missing.gpkg',
    { code: ERROR_CODES.TEMPLATE_VERSION_MISSING }
  ],
  [
    'a file with two version records',
    'service-template/version-record-duplicated.gpkg',
    { code: ERROR_CODES.TEMPLATE_VERSION_DUPLICATED }
  ],
  [
    'a file in a version the service does not read',
    'service-template/version-unsupported.gpkg',
    {
      code: ERROR_CODES.TEMPLATE_VERSION_UNSUPPORTED,
      message: expect.stringContaining('version 2.0'),
      details: { version: '2.0' }
    }
  ],
  [
    'a legacy Natural England file',
    LEGACY_FIXTURE,
    {
      code: ERROR_CODES.LEGACY_TEMPLATE_NOT_ACCEPTED,
      message: expect.stringMatching(/BNG Service template.*QGIS plugin/)
    }
  ],
  [
    'a file missing a table',
    'service-template/no-area-habitats-baseline-table.gpkg',
    {
      code: ERROR_CODES.GPKG_MISSING_LAYER,
      message: expect.stringContaining('Area Habitats Baseline')
    }
  ],
  [
    'a file with the wrong geometry type',
    'service-template/wrong-geometry-type-in-area-habitats.gpkg',
    {
      code: ERROR_CODES.GPKG_BASELINE_GEOMETRY_TYPE_NAME,
      message: expect.stringContaining('Area Habitats Baseline')
    }
  ]
]

const CASES = ENDPOINTS.flatMap(([endpoint, call]) =>
  REFUSALS.map(([what, fixture, error]) => [
    endpoint,
    what,
    fixture,
    error,
    call
  ])
)

describeServiceTemplate(
  'BNG Service template format gate — with the service-template flag on',
  () => {
    it.each(CASES)(
      'the %s endpoint refuses %s, and stores nothing',
      async (_endpoint, _what, fixture, error, call) => {
        const project = await createProject('Service template gate')
        const uploadId = await uploadFixture(fixture)

        const res = await call(uploadId, { projectId: project.id })

        expect(res.statusCode).toBe(HTTP_OK)
        expect(res.result.valid).toBe(false)
        expect(res.result.errors).toContainEqual(expect.objectContaining(error))

        const stored = await fetchProject(project.id)
        expect(stored.baseline).toBeUndefined()
        expect(stored.postIntervention).toBeUndefined()
      }
    )
  }
)

// The baseline + post-intervention endpoint cannot save a BNG Service template
// file until it reads both stages, so a file that passes the gate is refused
// there, rather than going on into the legacy reader. The baseline endpoint
// reads it: see service-template-baseline.test.js.
describeServiceTemplate(
  'BNG Service template at the baseline + post-intervention endpoint — with the service-template flag on',
  () => {
    it.each([
      ['a valid file holding both stages', 'service-template/plain-site.gpkg'],
      [
        'a valid baseline-stage file',
        'service-template/large-site-baseline.gpkg'
      ]
    ])('refuses %s as not yet read, and stores nothing', async (_, fixture) => {
      const project = await createProject('Service template not yet read')
      const uploadId = await uploadFixture(fixture)

      const res = await callPostInterventionValidate(uploadId, {
        projectId: project.id
      })

      expect(res.statusCode).toBe(HTTP_OK)
      expect(res.result).toEqual({
        valid: false,
        errors: [
          expect.objectContaining({
            code: ERROR_CODES.SERVICE_TEMPLATE_NOT_YET_READ,
            details: { template: { name: 'bng-service', version: '1.0' } }
          })
        ]
      })

      const stored = await fetchProject(project.id)
      expect(stored.baseline).toBeUndefined()
      expect(stored.postIntervention).toBeUndefined()
    })
  }
)
