import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { config } from '../../config.js'

import { ERROR_CODES } from '../../validation/geopackage/errors.js'
import { importUploadFile } from './import-upload-file.js'
import { projectAfterUpload } from './persist-upload.js'

// importUploadFile is what the metric comparison in bng-metric-harness calls
// to import a file as an upload does (BMD-1036), so these run real files
// through the real pipeline: nothing is mocked.

const FIXTURES = path.resolve(
  import.meta.dirname,
  '../../../integration-tests/fixtures'
)
const BASELINE_FILE = path.join(FIXTURES, 'baseline-complete.gpkg')
const POST_INTERVENTION_FILE = path.join(
  FIXTURES,
  'post-intervention-combined.gpkg'
)
const BASELINE = { projectDocumentKey: 'baseline' }
const POST_INTERVENTION = { projectDocumentKey: 'postIntervention' }
const IMPORT_TIMEOUT_MS = 30_000

const TEMPLATE_FIXTURES = path.join(FIXTURES, 'service-template')

const refsOf = (document) => document.habitats.map((h) => h.ref)

/**
 * Run a describe block's tests with the service-template flag set, as the
 * format gate reads it per upload, restoring it afterwards: the unit tests
 * also run with the flag on in CI.
 */
function withServiceTemplate(enabled) {
  let flagAsSet
  beforeAll(() => {
    flagAsSet = config.get('serviceTemplate.enabled')
    config.set('serviceTemplate.enabled', enabled)
  })
  afterAll(() => config.set('serviceTemplate.enabled', flagAsSet))
}

describe('importUploadFile, a legacy file', () => {
  withServiceTemplate(false)
  const scratch = mkdtempSync(path.join(tmpdir(), 'import-upload-file-'))
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  /** A copy of the post-intervention fixture, with `sql` run on it. */
  function editedPostIntervention(name, sql) {
    const copy = path.join(scratch, `${name}.gpkg`)
    copyFileSync(POST_INTERVENTION_FILE, copy)
    const db = new Database(copy)
    try {
      db.exec(sql)
    } finally {
      db.close()
    }
    return copy
  }

  async function importBaseline() {
    const result = await importUploadFile(BASELINE_FILE, {}, BASELINE)
    expect(result.accepted).toBe(true)
    return result.project
  }

  it(
    'stores a baseline upload as the baseline, and nothing else',
    async () => {
      const project = await importBaseline()

      expect(Object.keys(project)).toEqual(['baseline'])
      expect(refsOf(project.baseline)).toEqual(['H1', 'H2', 'H3'])
      expect(project.baseline.units.habitatsTotal).toBeGreaterThan(0)
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'replaces the baseline with the one a post-intervention file describes',
    async () => {
      const stored = await importBaseline()

      const result = await importUploadFile(
        POST_INTERVENTION_FILE,
        stored,
        POST_INTERVENTION
      )

      expect(result.accepted).toBe(true)
      const { baseline, postIntervention } = result.project
      expect(refsOf(baseline)).not.toContain('H1')
      expect(baseline.habitats.length).toBeGreaterThan(0)
      expect(postIntervention.habitats.length).toBeGreaterThan(0)
      expect(refsOf(stored.baseline)).toEqual(['H1', 'H2', 'H3'])
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'carries feature ids forward when the same file is uploaded again',
    async () => {
      const first = await importUploadFile(
        POST_INTERVENTION_FILE,
        {},
        POST_INTERVENTION
      )
      const second = await importUploadFile(
        POST_INTERVENTION_FILE,
        first.project,
        POST_INTERVENTION
      )

      const ids = (project) => project.baseline.habitats.map((h) => h.featureId)
      expect(ids(second.project)).toEqual(ids(first.project))
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'drops the post-intervention document when a baseline is uploaded again',
    async () => {
      const combined = await importUploadFile(
        POST_INTERVENTION_FILE,
        await importBaseline(),
        POST_INTERVENTION
      )

      const result = await importUploadFile(
        BASELINE_FILE,
        combined.project,
        BASELINE
      )

      expect(Object.keys(result.project)).toEqual(['baseline'])
    },
    IMPORT_TIMEOUT_MS
  )

  it('refuses a file the format gate refuses', async () => {
    const result = await importUploadFile(
      path.join(FIXTURES, 'not-a-valid-geopackage.gpkg'),
      {},
      BASELINE
    )

    expect(result).toMatchObject({ accepted: false })
    expect(result.errors.map((e) => e.code)).toEqual([
      ERROR_CODES.GPKG_INVALID_FILE
    ])
  })

  it.each([
    [
      ERROR_CODES.NO_DERIVED_BASELINE_HABITATS,
      'all-created',
      `UPDATE Habitats SET "Retention Category" = 'Created'`
    ],
    [
      ERROR_CODES.BASELINE_TYPE_MISSING,
      'blank-baseline-type',
      `UPDATE Habitats SET "Baseline Habitat Type" = NULL WHERE "Retention Category" = 'Retained'`
    ]
  ])(
    'refuses with %s, as the route does',
    async (code, name, sql) => {
      const result = await importUploadFile(
        editedPostIntervention(name, sql),
        await importBaseline(),
        POST_INTERVENTION
      )

      expect(result).toMatchObject({ accepted: false })
      expect(result.errors.map((e) => e.code)).toEqual([code])
    },
    IMPORT_TIMEOUT_MS
  )
})

describe('importUploadFile, a BNG Service template file', () => {
  withServiceTemplate(true)
  const SITE = path.join(TEMPLATE_FIXTURES, 'default-site.gpkg')

  it(
    'replaces the stored baseline with its Baseline tables, with the post-intervention upload',
    async () => {
      const fromFile = await importUploadFile(SITE, {}, BASELINE)
      // A stored baseline that differs from the file in every habitat, so
      // keeping it rather than replacing it cannot pass.
      const stored = structuredClone(fromFile.project)
      for (const habitat of stored.baseline.habitats) {
        habitat.ref = `OLD-${habitat.ref}`
        habitat.type = 'Modified grassland'
      }

      const result = await importUploadFile(SITE, stored, POST_INTERVENTION)

      expect(result.accepted).toBe(true)
      const typesOf = (document) =>
        document.habitats.map((h) => [h.ref, h.type])
      expect(typesOf(result.project.baseline)).toEqual(
        typesOf(fromFile.project.baseline)
      )
      expect(result.project.baseline.units.habitatsTotal).toBeCloseTo(
        fromFile.project.baseline.units.habitatsTotal,
        10
      )
      expect(result.project.postIntervention.habitats.length).toBeGreaterThan(0)
    },
    IMPORT_TIMEOUT_MS
  )

  // The parent links are checked in the geometry pass, which runs on this
  // thread here rather than in a worker.
  it.each([
    ['lineage-parent-missing.gpkg', ERROR_CODES.STAGED_PARENT_LINK_MISSING],
    ['lineage-parent-unknown.gpkg', ERROR_CODES.STAGED_UNKNOWN_PARENT_REF]
  ])(
    'refuses %s for its parent links',
    async (file, code) => {
      const result = await importUploadFile(
        path.join(TEMPLATE_FIXTURES, file),
        {},
        POST_INTERVENTION
      )

      expect(result).toMatchObject({ accepted: false })
      expect(result.errors.map((e) => e.code)).toContain(code)
    },
    IMPORT_TIMEOUT_MS
  )

  it('refuses a legacy file at the format gate', async () => {
    const result = await importUploadFile(BASELINE_FILE, {}, BASELINE)

    expect(result.accepted).toBe(false)
  })
})

describe('projectAfterUpload', () => {
  withServiceTemplate(false)
  let baselineUpload
  let combinedUpload
  beforeAll(async () => {
    const baseline = await importUploadFile(BASELINE_FILE, {}, BASELINE)
    const combined = await importUploadFile(
      POST_INTERVENTION_FILE,
      baseline.project,
      POST_INTERVENTION
    )
    // buildUploadDocuments' result, as projectAfterUpload is given it.
    baselineUpload = { document: baseline.project.baseline }
    combinedUpload = {
      baseline: { document: combined.project.baseline },
      postIntervention: { document: combined.project.postIntervention }
    }
  }, IMPORT_TIMEOUT_MS)

  /** A copy of `document` with a key no schema names. */
  const withUnknownKey = (document) => ({ ...document, notInTheSchema: true })

  it('accepts the documents an upload builds', () => {
    expect(() =>
      projectAfterUpload({}, baselineUpload, 'baseline')
    ).not.toThrow()
    expect(() =>
      projectAfterUpload({}, combinedUpload, 'postIntervention')
    ).not.toThrow()
  })

  // The upload pipeline's own schema check allows unknown keys; the write's
  // does not, so these documents pass the one and fail the other.
  it('refuses a baseline upload whose document the write would refuse', () => {
    expect(() =>
      projectAfterUpload(
        {},
        { document: withUnknownKey(baselineUpload.document) },
        'baseline'
      )
    ).toThrow(/project\.baseline failed schema validation before persist/)
  })

  it.each([
    ['baseline', /project\.baseline failed/],
    ['postIntervention', /project\.postIntervention failed/]
  ])(
    'refuses a combined upload whose %s document the write would refuse',
    (half, message) => {
      const extracted = {
        ...combinedUpload,
        [half]: { document: withUnknownKey(combinedUpload[half].document) }
      }

      expect(() =>
        projectAfterUpload({}, extracted, 'postIntervention')
      ).toThrow(message)
    }
  )
})
