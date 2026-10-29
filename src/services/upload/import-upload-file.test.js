import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, describe, expect, it } from 'vitest'

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

const refsOf = (document) => document.habitats.map((h) => h.ref)

describe('importUploadFile', () => {
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

describe('projectAfterUpload', () => {
  const stored = Object.freeze({
    name: 'Site',
    baseline: {},
    postIntervention: {}
  })

  it('refuses a document the write would refuse', () => {
    expect(() =>
      projectAfterUpload(stored, { document: { habitats: 'none' } }, 'baseline')
    ).toThrow(/project\.baseline failed schema validation before persist/)
  })
})
