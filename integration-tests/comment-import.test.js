import { afterEach, expect, it } from 'vitest'
import { copyFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

// The first suite uploads a legacy file, so it runs with the service-template
// flag off only. The second uploads a BNG Service template file and runs with
// the flag on.
import {
  describeLegacy as describe,
  describeServiceTemplate
} from '../test/helpers/template-mode.js'
import { fixturePath } from './helpers/upload-fixtures.js'
import { HTTP_OK } from './helpers/http-status.js'
import {
  FIXTURE,
  callPostInterventionValidate,
  callValidate,
  createProject,
  fetchProject,
  registerPersistenceTestHooks,
  uploadFixture
} from './helpers/persistence-test-setup.js'

registerPersistenceTestHooks()

const COMMENT_LIMIT = 999
const temporaryDirectories = []

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true })
  }
})

/**
 * A copy of the combined fixture with attribute-only edits. Geometry triggers
 * must not run: better-sqlite3 resolves their spatial functions while preparing
 * the update.
 *
 * @param {(db: import('better-sqlite3').Database) => void} edit
 * @returns {Promise<string>} the upload id
 */
async function editedFixture(edit) {
  const directory = await mkdtemp(path.join(tmpdir(), 'comment-import-'))
  temporaryDirectories.push(directory)
  const file = path.join(directory, 'comments.gpkg')
  await copyFile(fixturePath(FIXTURE), file)
  const db = new Database(file)
  try {
    for (const name of [
      'ST_IsEmpty',
      'ST_MinX',
      'ST_MaxX',
      'ST_MinY',
      'ST_MaxY'
    ]) {
      db.function(name, { varargs: true }, () => {
        throw new Error('Comment fixture changed geometry')
      })
    }
    edit(db)
  } finally {
    db.close()
  }
  return uploadFixture(FIXTURE, file)
}

function commentOf(features, ref) {
  return features.find((feature) => feature.ref === ref)?.comment
}

describe('habitat comments on upload', () => {
  it('saves a trimmed comment on the baseline habitat, or on the enhanced or created habitat', async () => {
    const project = await createProject('Comment placement')
    const uploadId = await editedFixture((db) => {
      db.prepare(
        `UPDATE Habitats SET "Comment" = ? WHERE "Parcel Ref" = 'H1'`
      ).run('  kept  note  ')
      db.prepare(
        `UPDATE Habitats SET "Comment" = ? WHERE "Parcel Ref" = 'H2'`
      ).run('  enhanced note  ')
      db.prepare(
        `UPDATE Habitats SET "Retention Category" = 'Created', "Comment" = ? WHERE "Parcel Ref" = 'H3'`
      ).run('created note')
      db.prepare(
        `UPDATE Hedgerows SET "Comments" = ? WHERE "Parcel Ref" = 'H1'`
      ).run('\nhedge note\t')
      db.prepare(
        `UPDATE Rivers SET "Comments" = ? WHERE "Parcel Ref" = 'R1'`
      ).run('   ')
    })

    const response = await callPostInterventionValidate(uploadId, {
      projectId: project.id
    })
    expect(response.statusCode).toBe(HTTP_OK)
    expect(response.result).toEqual({ valid: true, errors: [] })

    const stored = await fetchProject(project.id)
    expect(commentOf(stored.baseline.habitats, 'H1')).toBe('kept  note')
    expect(commentOf(stored.baseline.habitats, 'H2')).toBeNull()
    expect(
      stored.baseline.habitats.map((habitat) => habitat.ref)
    ).not.toContain('H3')
    expect(commentOf(stored.baseline.hedgerows, 'H1')).toBe('hedge note')
    expect(commentOf(stored.baseline.watercourses, 'R1')).toBeNull()

    expect(commentOf(stored.postIntervention.habitats, 'H1')).toBeNull()
    expect(commentOf(stored.postIntervention.habitats, 'H2')).toBe(
      'enhanced note'
    )
    expect(commentOf(stored.postIntervention.habitats, 'H3')).toBe(
      'created note'
    )
    expect(commentOf(stored.postIntervention.hedgerows, 'H1')).toBeNull()
    expect(commentOf(stored.postIntervention.watercourses, 'R1')).toBeNull()
  })

  it.each([
    [
      'too long, by the length check before any other check (BMD-1175)',
      (db) =>
        db
          .prepare(
            `UPDATE Habitats SET "Comment" = ? WHERE "Parcel Ref" = 'H1'`
          )
          .run(`  ${'a'.repeat(COMMENT_LIMIT + 1)}  `),
      ['TEXT_TOO_LONG']
    ],
    [
      'not UTF-8',
      (db) =>
        db
          .prepare(
            `UPDATE Habitats SET "Comment" = CAST(X'48FF3031' AS TEXT) WHERE "Parcel Ref" = 'H2'`
          )
          .run(),
      ['COMMENT_INVALID_CHARACTERS']
    ]
  ])(
    'rejects the file and saves nothing when a comment is %s',
    async (_label, edit, codes) => {
      const project = await createProject('Comment dropout')
      const firstUpload = await uploadFixture(FIXTURE)
      const saved = await callValidate(firstUpload, { projectId: project.id })
      expect(saved.result).toEqual({ valid: true, errors: [] })
      const before = await fetchProject(project.id)

      const uploadId = await editedFixture(edit)

      const response = await callPostInterventionValidate(uploadId, {
        projectId: project.id
      })
      expect(response.statusCode).toBe(HTTP_OK)
      expect(response.result.valid).toBe(false)
      expect(response.result.errors.map((error) => error.code)).toEqual(codes)
      expect(await fetchProject(project.id)).toEqual(before)
    }
  )
})

const TEMPLATE_FIXTURE = 'service-template/plain-site.gpkg'

/**
 * A copy of the template fixture with attribute-only edits.
 *
 * @param {(db: import('better-sqlite3').Database) => void} edit
 * @returns {Promise<string>} the upload id
 */
async function editedTemplate(edit) {
  const directory = await mkdtemp(path.join(tmpdir(), 'comment-template-'))
  temporaryDirectories.push(directory)
  const file = path.join(directory, 'comments.gpkg')
  await copyFile(fixturePath(TEMPLATE_FIXTURE), file)
  const db = new Database(file)
  try {
    edit(db)
  } finally {
    db.close()
  }
  return uploadFixture(TEMPLATE_FIXTURE, file)
}

function setComment(db, table, ref, comment) {
  db.prepare(`UPDATE "${table}" SET "Comment" = ? WHERE "Habitat Ref" = ?`).run(
    comment,
    ref
  )
}

describeServiceTemplate(
  'habitat comments on a BNG Service template upload',
  () => {
    it('saves the Baseline and Post-Intervention comments for Retained, Enhanced and Created rows', async () => {
      const project = await createProject('Template comment placement')
      const uploadId = await editedTemplate((db) => {
        setComment(
          db,
          'Area Habitats Baseline',
          'H001',
          '  baseline enhanced  '
        )
        setComment(db, 'Area Habitats Baseline', 'H002', 'baseline retained')
        setComment(db, 'Area Habitats Baseline', 'H005', 'baseline created')
        setComment(db, 'Area Habitats Post-Intervention', 'H001', 'pi enhanced')
        setComment(
          db,
          'Area Habitats Post-Intervention',
          'H002',
          '  pi retained  '
        )
        setComment(db, 'Area Habitats Post-Intervention', 'H005', 'pi created')
      })

      const response = await callPostInterventionValidate(uploadId, {
        projectId: project.id
      })
      expect(response.statusCode).toBe(HTTP_OK)
      expect(response.result).toEqual({ valid: true, errors: [] })

      const stored = await fetchProject(project.id)
      expect(commentOf(stored.baseline.habitats, 'H001')).toBe(
        'baseline enhanced'
      )
      expect(commentOf(stored.baseline.habitats, 'H002')).toBe(
        'baseline retained'
      )
      expect(commentOf(stored.baseline.habitats, 'H005')).toBe(
        'baseline created'
      )
      expect(commentOf(stored.postIntervention.habitats, 'H001')).toBe(
        'pi enhanced'
      )
      expect(commentOf(stored.postIntervention.habitats, 'H002')).toBe(
        'pi retained'
      )
      expect(commentOf(stored.postIntervention.habitats, 'H005')).toBe(
        'pi created'
      )
    })
  }
)
