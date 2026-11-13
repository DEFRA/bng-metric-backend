import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { config } from '../../config.js'

import { ERROR_CODES } from '../../validation/geopackage/errors.js'
import { importUploadFile } from './import-upload-file.js'
import { uploadRefusal } from './save-upload-for-project.js'
import { projectAfterUpload } from './persist-upload.js'
import { expectDeclaredDetails } from '../../../test/helpers/declared-details.js'

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

const BASELINE_LAYERS = ['habitats', 'hedgerows', 'watercourses']

/** The baseline area habitats, hedgerows and watercourses that are not Complete. */
const incompleteBaselineRefs = (baseline) =>
  BASELINE_LAYERS.flatMap((layer) =>
    baseline[layer].filter((f) => f.status !== 'Complete').map((f) => f.ref)
  )

/** Expect `result` to be the one BMD-1195 refusal, naming `layer` `ref`. */
function expectIncompleteBaselineRefusal(result, layer, ref) {
  expect(result.accepted).toBe(false)
  expect(result.errors).toEqual([
    expect.objectContaining({
      code: ERROR_CODES.BASELINE_HABITATS_INCOMPLETE,
      details: {
        count: 1,
        sample: [expect.objectContaining({ layer, feature_ref: ref })]
      }
    })
  ])
  expectDeclaredDetails(result.errors[0])
}

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

  describe('BMD-1195 a baseline habitat the file leaves incomplete', () => {
    it.each([
      [
        'AC1 an area habitat with no Baseline Condition',
        'habitats',
        'H002',
        `UPDATE Habitats SET "Baseline Condition" = NULL WHERE "Parcel Ref" = 'H002'`
      ],
      [
        'AC1 an area habitat with no Baseline Broad Habitat Type',
        'habitats',
        'H002',
        `UPDATE Habitats SET "Baseline Broad Habitat Type" = NULL WHERE "Parcel Ref" = 'H002'`
      ],
      [
        'AC1 a Lost area habitat with no Baseline Condition',
        'habitats',
        'H003',
        `UPDATE Habitats SET "Baseline Condition" = NULL WHERE "Parcel Ref" = 'H003'`
      ],
      [
        'AC2 a hedgerow with no Baseline Condition',
        'hedgerows',
        'HG004',
        `UPDATE Hedgerows SET "Baseline Condition" = NULL WHERE "Parcel Ref" = 'HG004'`
      ],
      [
        'AC3 a watercourse with no Baseline Condition',
        'watercourses',
        'R002',
        `UPDATE Rivers SET "Baseline Condition" = NULL WHERE "Parcel Ref" = 'R002'`
      ],
      [
        'AC3 a watercourse with no baseline Encroachment into Watercourse',
        'watercourses',
        'R002',
        `UPDATE Rivers SET "Baseline Encroachment into Watercourse" = NULL WHERE "Parcel Ref" = 'R002'`
      ],
      [
        'AC3 a watercourse with no baseline Encroachment into riparian zone',
        'watercourses',
        'R002',
        `UPDATE Rivers SET "Baseline Encroachment into riparian zone" = NULL WHERE "Parcel Ref" = 'R002'`
      ]
    ])(
      '%s refuses the post-intervention file, and saves nothing',
      async (name, layer, ref, sql) => {
        const stored = await importBaseline()
        const before = structuredClone(stored)

        const result = await importUploadFile(
          editedPostIntervention(name.replaceAll(/\W+/g, '-'), sql),
          stored,
          POST_INTERVENTION
        )

        expectIncompleteBaselineRefusal(result, layer, ref)
        expect(result.project).toBeUndefined()
        expect(stored).toEqual(before)
      },
      IMPORT_TIMEOUT_MS
    )

    it(
      'AC6 saves the same file uploaded as a baseline, with the habitat Incomplete',
      async () => {
        const result = await importUploadFile(
          editedPostIntervention(
            'baseline-only-incomplete',
            `UPDATE Hedgerows SET "Baseline Condition" = NULL WHERE "Parcel Ref" = 'HG004'`
          ),
          {},
          BASELINE
        )

        expect(result.accepted).toBe(true)
        expect(incompleteBaselineRefs(result.project.baseline)).toEqual([
          'HG004'
        ])
      },
      IMPORT_TIMEOUT_MS
    )

    it(
      'AC4 accepts a file whose baseline habitats are all complete, and saves them Complete',
      async () => {
        const result = await importUploadFile(
          POST_INTERVENTION_FILE,
          await importBaseline(),
          POST_INTERVENTION
        )

        expect(result.accepted).toBe(true)
        expect(incompleteBaselineRefs(result.project.baseline)).toEqual([])
      },
      IMPORT_TIMEOUT_MS
    )

    it(
      'AC5 does not count Created rows, which have no baseline, even with blank Baseline columns',
      async () => {
        const result = await importUploadFile(
          editedPostIntervention(
            'created-blank-baseline',
            [
              `UPDATE Hedgerows SET "Baseline Hedge Type" = NULL, "Baseline Condition" = NULL WHERE "Retention Category" = 'Created';`,
              `UPDATE Rivers SET "Baseline River Type" = NULL, "Baseline Condition" = NULL, "Baseline Encroachment into Watercourse" = NULL, "Baseline Encroachment into riparian zone" = NULL WHERE "Retention Category" = 'Created';`
            ].join('\n')
          ),
          await importBaseline(),
          POST_INTERVENTION
        )

        expect(result.accepted).toBe(true)
        const { baseline, postIntervention } = result.project
        expect(incompleteBaselineRefs(baseline)).toEqual([])
        const created = [
          ...postIntervention.hedgerows,
          ...postIntervention.watercourses
        ].filter((f) => f.retentionCategory === 'Created')
        expect(created.map((f) => f.ref)).toEqual(
          expect.arrayContaining(['HG005', 'R003'])
        )
      },
      IMPORT_TIMEOUT_MS
    )
  })
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

  it(
    'reads its vertical area habitats, sized by their typed area in hectares, into both documents',
    async () => {
      const result = await importUploadFile(SITE, {}, POST_INTERVENTION)

      expect(result.accepted).toBe(true)
      const { baseline, postIntervention } = result.project
      // The file types each area in hectares (V001 is 0.0093 ha, 93 m²).
      expect(baseline.verticalHabitats.map((v) => v.ref)).toEqual([
        'V001',
        'V002',
        'V003',
        'V004',
        'V005'
      ])
      expect(baseline.verticalHabitats[0]).toMatchObject({
        sizeSquareMetres: 93,
        status: 'Complete',
        units: expect.any(Number)
      })
      expect(baseline.verticalHabitats[0].units).toBeGreaterThan(0)
      const verticalSquareMetres = baseline.verticalHabitats.reduce(
        (sum, v) => sum + v.sizeSquareMetres,
        0
      )
      expect(baseline.habitatSizes.verticalHabitats.totalSquareMetres).toBe(
        verticalSquareMetres
      )
      expect(baseline.habitatSizes.areaHabitats.totalSquareMetres).toBeCloseTo(
        baseline.habitatSizes.site.totalSquareMetres +
          baseline.habitatSizes.trees.totalSquareMetres +
          verticalSquareMetres,
        6
      )
      expect(baseline.units.verticalHabitatsTotal).toBeGreaterThan(0)

      // A demolished structure (V004) has no post-intervention row, and is
      // recorded as removed.
      expect(postIntervention.verticalHabitats.map((v) => v.ref)).toEqual([
        'V001',
        'V002',
        'V003',
        'V005'
      ])
      expect(
        postIntervention.verticalHabitats.every((v) => v.parentFeatureId)
      ).toBe(true)
      expect(postIntervention.lostHabitats).toContainEqual(
        expect.objectContaining({
          layer: 'verticalHabitats',
          ref: 'V004',
          outcome: 'removed'
        })
      )
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'BMD-1195 refuses a file whose Area Habitats Baseline table has an incomplete habitat',
    async () => {
      const scratch = mkdtempSync(path.join(tmpdir(), 'incomplete-baseline-'))
      try {
        const copy = path.join(scratch, 'incomplete-baseline.gpkg')
        copyFileSync(SITE, copy)
        const db = new Database(copy)
        try {
          db.exec(
            `UPDATE "Area Habitats Baseline" SET "Baseline Condition" = NULL WHERE "Habitat Ref" = 'H001'`
          )
        } finally {
          db.close()
        }

        const refused = await importUploadFile(copy, {}, POST_INTERVENTION)
        expectIncompleteBaselineRefusal(refused, 'habitats', 'H001')

        // AC6: the baseline endpoint still takes it.
        const baselineOnly = await importUploadFile(copy, {}, BASELINE)
        expect(baselineOnly.accepted).toBe(true)
        expect(incompleteBaselineRefs(baselineOnly.project.baseline)).toEqual([
          'H001'
        ])
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    },
    IMPORT_TIMEOUT_MS
  )

  it.each([
    ['negative', -12],
    ['zero', 0],
    ['blank', null]
  ])(
    'refuses a vertical area habitat whose Area is %s',
    async (_, area) => {
      const scratch = mkdtempSync(path.join(tmpdir(), 'vertical-area-'))
      try {
        const copy = path.join(scratch, 'vertical-area.gpkg')
        copyFileSync(SITE, copy)
        const db = new Database(copy)
        try {
          db.prepare(
            `UPDATE "Vertical Area Habitats Baseline" SET Area = ? WHERE "Habitat Ref" = 'V001'`
          ).run(area)
        } finally {
          db.close()
        }

        const result = await importUploadFile(copy, {}, POST_INTERVENTION)

        expect(result.accepted).toBe(false)
        const error = result.errors.find(
          (e) => e.code === ERROR_CODES.VERTICAL_HABITAT_AREA_NOT_POSITIVE
        )
        expect(error.details.sample).toEqual([
          expect.objectContaining({ feature_ref: 'V001', area })
        ])
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
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

describe('importUploadFile, a BNG Service template file’s individual trees', () => {
  withServiceTemplate(true)
  const SITE = path.join(TEMPLATE_FIXTURES, 'default-site.gpkg')
  const BASELINE_TREES = 'Individual Trees Baseline'
  const PI_TREES = 'Individual Trees Post-Intervention'
  const scratch = mkdtempSync(path.join(tmpdir(), 'import-trees-'))
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  // The Metric's figures for a tree (User Guide, Table 15; the Metric's
  // distinctiveness and condition scores): an individual tree is a Medium
  // habitat, score 4.
  const HECTARES = { Small: 0.0041, Medium: 0.0163, 'Very large': 0.0765 }
  const MEDIUM_DISTINCTIVENESS = 4
  const CONDITION = { 'Fairly Poor': 1.5, Moderate: 2, Good: 3, Poor: 1 }

  /** A copy of the default site with `sql` run on it. */
  function editedSite(name, sql) {
    const copy = path.join(scratch, `${name}.gpkg`)
    copyFileSync(SITE, copy)
    const db = new Database(copy)
    try {
      db.exec(sql)
    } finally {
      db.close()
    }
    return copy
  }

  const byRef = (trees, ref) => trees.find((tree) => tree.ref === ref)

  async function importSite(name, sql) {
    const result = await importUploadFile(
      editedSite(name, sql),
      {},
      POST_INTERVENTION
    )
    expect(result.errors ?? []).toEqual([])
    return result.project
  }

  it(
    'prices each tree as one tree at its size class’s area, as an Urban or Rural tree, a Count in the file not read',
    async () => {
      const { baseline } = await importSite(
        'counts',
        `ALTER TABLE "${BASELINE_TREES}" ADD COLUMN "Count" INTEGER;
         UPDATE "${BASELINE_TREES}" SET Count = 3 WHERE "Habitat Ref" = 'T002';`
      )

      // T002 is one Medium Rural tree in Poor condition.
      const t002 = byRef(baseline.trees, 'T002')
      expect(t002).toMatchObject({
        type: 'Rural tree',
        treeSize: 'Medium',
        sizeSquareMetres: 163
      })
      expect(t002.count ?? null).toBeNull()
      expect(t002.units).toBeCloseTo(
        HECTARES.Medium * MEDIUM_DISTINCTIVENESS * CONDITION.Poor,
        10
      )
      expect(byRef(baseline.trees, 'T003')).toMatchObject({
        type: 'Urban tree',
        sizeSquareMetres: 366
      })
    },
    IMPORT_TIMEOUT_MS
  )

  // A tree's Irreplaceable Habitat must say "No": "Yes", a blank cell or any
  // other value refuses the file, at either stage.
  it.each([
    ['baseline', BASELINE_TREES, "'Yes'"],
    ['post-intervention', PI_TREES, "'Yes'"],
    ['baseline', BASELINE_TREES, "''"],
    ['post-intervention', PI_TREES, 'NULL']
  ])(
    'refuses a tree at %s whose Irreplaceable Habitat is not No (%s, set to %s), naming it',
    async (stage, table, value) => {
      const result = await importUploadFile(
        editedSite(
          `irreplaceable-${stage}-${value.replaceAll("'", '')}`,
          `UPDATE "${table}" SET "Irreplaceable Habitat" = ${value} WHERE "Habitat Ref" = 'T004';`
        ),
        {},
        POST_INTERVENTION
      )

      expect(result.accepted).toBe(false)
      const error = result.errors.find(
        (e) => e.code === ERROR_CODES.IRREPLACEABLE_TREE
      )
      expect(error.message).toContain(`${table} Habitat Ref T004`)
      expect(error.message).toContain(
        'Irreplaceable Habitat must be "No" for every tree, because the service does not accept irreplaceable trees'
      )
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'loses a felled tree in full, and nothing of a kept one',
    async () => {
      const { postIntervention } = await importSite('felled', '')

      const lost = (ref) =>
        postIntervention.lostHabitats.find(
          (entry) => entry.layer === 'trees' && entry.ref === ref
        )
      // T002 has no post-intervention point.
      expect(lost('T002')).toMatchObject({
        outcome: 'removed',
        lostTreeCount: 1,
        lostSizeSquareMetres: 163
      })
      // T004, a Very large tree, is kept.
      expect(lost('T004')).toBeUndefined()
      const t004 = byRef(postIntervention.trees, 'T004')
      expect(t004.sizeSquareMetres).toBe(765)
      expect(t004.units).toBeCloseTo(
        HECTARES['Very large'] *
          MEDIUM_DISTINCTIVENESS *
          CONDITION['Fairly Poor'],
        10
      )
      expect(lost('T010')).toBeUndefined()
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'refuses a tree kept by more than one point, naming it',
    async () => {
      // A second Retained point copied from T004's.
      const result = await importUploadFile(
        editedSite(
          'too-many',
          `CREATE TEMP TABLE copied AS SELECT * FROM "${PI_TREES}" WHERE "Habitat Ref" = 'T004';
           UPDATE copied SET fid = (SELECT MAX(fid) + 1 FROM "${PI_TREES}"),
             "Habitat Ref" = 'T004b';
           INSERT INTO "${PI_TREES}" SELECT * FROM copied;`
        ),
        {},
        POST_INTERVENTION
      )

      expect(result.accepted).toBe(false)
      const error = result.errors.find(
        (e) => e.code === ERROR_CODES.STAGED_TREE_CHILDREN_TOO_MANY
      )
      expect(error.message).toContain('Individual Trees Baseline T004')
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'prices an Enhanced tree as a condition enhancement at its baseline size, type and setting',
    async () => {
      // The file proposes T006, a Small Rural tree, as a Very large Urban
      // tree: a kept tree's growth is not recorded.
      const { postIntervention } = await importSite(
        'enhanced',
        `UPDATE "${PI_TREES}" SET "Proposed Tree Size" = 'Very large', "Proposed Rural or Urban Tree" = 'Urban tree' WHERE "Habitat Ref" = 'T006';`
      )

      const t006 = byRef(postIntervention.trees, 'T006')
      expect(t006).toMatchObject({
        status: 'Complete',
        sizeSquareMetres: 41,
        proposed: {
          treeSize: 'Small',
          type: 'Rural tree',
          ruralOrUrban: 'Rural tree',
          condition: 'Good'
        }
      })
      expect(t006.units).toBeGreaterThan(0)
      // The document's tree sizes count it as it is kept, not as proposed.
      const sizes = postIntervention.habitatSizes
      const sum = (trees) =>
        trees.reduce((total, tree) => total + tree.sizeSquareMetres, 0)
      const ofType = (type) =>
        postIntervention.trees.filter((tree) => tree.proposed.type === type)
      expect(sizes.trees).toEqual({
        totalSquareMetres: sum(postIntervention.trees),
        urbanSquareMetres: sum(ofType('Urban tree')),
        ruralSquareMetres: sum(ofType('Rural tree'))
      })
      expect(sizes.areaHabitats.totalSquareMetres).toBeCloseTo(
        sizes.site.totalSquareMetres +
          sizes.trees.totalSquareMetres +
          sizes.verticalHabitats.totalSquareMetres,
        6
      )
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'saves an Enhanced tree whose condition is not better Incomplete, with its Proposed Condition null',
    async () => {
      // T006 is in Moderate condition at baseline.
      const { postIntervention } = await importSite(
        'enhanced-not-better',
        `UPDATE "${PI_TREES}" SET "Proposed Condition" = 'Moderate' WHERE "Habitat Ref" = 'T006';`
      )

      const t006 = byRef(postIntervention.trees, 'T006')
      expect(t006).toMatchObject({
        status: 'Incomplete',
        invalidEnhancement: 'tree-better-condition',
        units: null,
        proposed: { condition: null, treeSize: 'Small' }
      })
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'refuses an Enhanced tree whose baseline tree is in Good condition, naming it, as a Good tree cannot be enhanced',
    async () => {
      // T006 is Enhanced from Moderate to Good; its baseline is set to Good.
      const result = await importUploadFile(
        editedSite(
          'enhanced-from-good',
          `UPDATE "${BASELINE_TREES}" SET "Baseline Condition" = 'Good' WHERE "Habitat Ref" = 'T006';
           UPDATE "${PI_TREES}" SET "Baseline Condition" = 'Good' WHERE "Habitat Ref" = 'T006';`
        ),
        {},
        POST_INTERVENTION
      )

      expect(result.accepted).toBe(false)
      expect(result.errors.map((e) => e.code)).toEqual([
        ERROR_CODES.TREE_NOT_ENHANCEABLE
      ])
      expect(result.errors[0].details.sample).toEqual([
        expect.objectContaining({
          layer: 'trees',
          feature_ref: 'T006',
          condition: 'Good'
        })
      ])
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'prices a Created tree as a creation at its planted size, linked to a parent or not',
    async () => {
      // T005 is planted with no parent; T010, felled, is replaced by a newly
      // planted Small Urban tree linked to it.
      const { postIntervention } = await importSite(
        'created',
        `UPDATE "${PI_TREES}" SET "Habitat Ref" = 'T010R', "Retention Category" = 'Created',
           Category = 'Newly Planted', "Proposed Tree Size" = 'Small',
           "Proposed Rural or Urban Tree" = 'Urban tree', "Proposed Condition" = 'Moderate'
         WHERE "Habitat Ref" = 'T010';`
      )

      const t005 = byRef(postIntervention.trees, 'T005')
      expect(t005).toMatchObject({
        status: 'Complete',
        sizeSquareMetres: 366
      })
      expect(t005.units).toBeGreaterThan(0)
      const replacement = byRef(postIntervention.trees, 'T010R')
      expect(replacement).toMatchObject({
        retentionCategory: 'Created',
        parentFeatureId: expect.any(String),
        status: 'Complete',
        sizeSquareMetres: 41,
        proposed: { treeSize: 'Small', type: 'Urban tree' }
      })
      // The felled tree is still lost in full: planting is not keeping it.
      expect(
        postIntervention.lostHabitats.find((entry) => entry.ref === 'T010')
      ).toMatchObject({ layer: 'trees', outcome: 'lost', lostTreeCount: 1 })
    },
    IMPORT_TIMEOUT_MS
  )
})

describe('importUploadFile, a BNG Service template file’s tree whose condition gets worse', () => {
  withServiceTemplate(true)
  const SITE = path.join(TEMPLATE_FIXTURES, 'default-site.gpkg')
  const PI_TREES = 'Individual Trees Post-Intervention'
  const scratch = mkdtempSync(path.join(tmpdir(), 'import-degraded-tree-'))
  afterAll(() => rmSync(scratch, { recursive: true, force: true }))

  // The Metric's figures for T004, a Very large Rural tree in Fairly Poor
  // condition at baseline (User Guide, Table 15; the Metric's scores): a
  // Medium habitat, score 4. Created again in Poor condition, its time to
  // target is 10 years, which 30+ years in advance covers, so its time
  // multiplier is 1; tree creation is Low difficulty, 1; Low significance, 1.
  const VERY_LARGE_HECTARES = 0.0765
  const MEDIUM_DISTINCTIVENESS = 4
  const FAIRLY_POOR = 1.5
  const POOR = 1
  const BASELINE_UNITS =
    VERY_LARGE_HECTARES * MEDIUM_DISTINCTIVENESS * FAIRLY_POOR
  const CREATED_UNITS = VERY_LARGE_HECTARES * MEDIUM_DISTINCTIVENESS * POOR

  /** The default site with T004 recorded as lost and created again, worse. */
  function degradedSite(name, values) {
    const copy = path.join(scratch, `${name}.gpkg`)
    copyFileSync(SITE, copy)
    const db = new Database(copy)
    try {
      const columns = Object.keys(values)
      db.prepare(
        `UPDATE "${PI_TREES}" SET ${columns.map((c) => `"${c}" = ?`).join(', ')} WHERE "Habitat Ref" = 'T004'`
      ).run(...Object.values(values))
    } finally {
      db.close()
    }
    return copy
  }

  const DEGRADED = {
    'Retention Category': 'Created',
    Category: 'Existing',
    'Proposed Condition': 'Poor',
    'Proposed Strategic Significance': 'Low',
    'Habitat Created/Enhanced in advance/years': '30+',
    'Delay in starting habitat creation/enhancement in years': '0'
  }

  it(
    'records the baseline tree as lost and the same tree as created, worse, and prices both as the Metric does',
    async () => {
      const result = await importUploadFile(
        degradedSite('degraded', DEGRADED),
        {},
        POST_INTERVENTION
      )

      expect(result.errors ?? []).toEqual([])
      const { baseline, postIntervention } = result.project
      const parent = baseline.trees.find((tree) => tree.ref === 'T004')
      const created = postIntervention.trees.find((tree) => tree.ref === 'T004')
      expect(parent.units).toBeCloseTo(BASELINE_UNITS, 10)
      expect(created).toMatchObject({
        retentionCategory: 'Created',
        parentFeatureId: parent.featureId,
        status: 'Complete',
        sizeSquareMetres: 765,
        proposed: {
          treeSize: 'Very large',
          type: 'Rural tree',
          condition: 'Poor',
          advanceYears: 30
        }
      })
      expect(created.units).toBeCloseTo(CREATED_UNITS, 10)
      expect(
        postIntervention.lostHabitats.find((lost) => lost.ref === 'T004')
      ).toEqual({
        layer: 'trees',
        featureId: parent.featureId,
        ref: 'T004',
        type: 'Rural tree',
        outcome: 'lostAndRecreated',
        lostSizeSquareMetres: 765,
        lostTreeCount: 1,
        recreatedAs: [created.featureId]
      })
    },
    IMPORT_TIMEOUT_MS
  )

  it(
    'reads a blank proposed setting as the baseline one, keeping the condition, timing and units',
    async () => {
      const result = await importUploadFile(
        degradedSite('degraded-blank-setting', {
          ...DEGRADED,
          'Proposed Rural or Urban Tree': null
        }),
        {},
        POST_INTERVENTION
      )

      expect(result.errors ?? []).toEqual([])
      const { baseline, postIntervention } = result.project
      const parent = baseline.trees.find((tree) => tree.ref === 'T004')
      const created = postIntervention.trees.find((tree) => tree.ref === 'T004')
      expect(created).toMatchObject({
        status: 'Complete',
        sizeSquareMetres: 765,
        proposed: {
          type: 'Rural tree',
          condition: 'Poor',
          strategicSignificance: 'Low',
          advanceYears: 30,
          delayYears: 0
        }
      })
      expect(created.units).toBeCloseTo(CREATED_UNITS, 10)
      expect(
        postIntervention.lostHabitats.find((lost) => lost.ref === 'T004')
      ).toMatchObject({
        outcome: 'lostAndRecreated',
        recreatedAs: [created.featureId],
        featureId: parent.featureId
      })
    },
    IMPORT_TIMEOUT_MS
  )

  it.each([
    [
      'in the same condition',
      { 'Proposed Condition': 'Fairly Poor' },
      ERROR_CODES.STAGED_DEGRADE_NOT_WORSE
    ],
    [
      'not 30+ years in advance',
      { 'Habitat Created/Enhanced in advance/years': '5' },
      ERROR_CODES.STAGED_DEGRADE_ADVANCE_NOT_30_PLUS
    ]
  ])(
    'refuses an Existing tree Created %s',
    async (name, overrides, code) => {
      const result = await importUploadFile(
        degradedSite(name.replaceAll(' ', '-'), { ...DEGRADED, ...overrides }),
        {},
        POST_INTERVENTION
      )

      expect(result.accepted).toBe(false)
      expect(result.errors.map((e) => e.code)).toContain(code)
    },
    IMPORT_TIMEOUT_MS
  )
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

// The route and importUploadFile both answer a refusal with this, so a new
// way buildUploadDocuments refuses an upload reaches both.
describe('uploadRefusal', () => {
  it('is null for documents that were built', () => {
    expect(uploadRefusal({ document: {} })).toBeNull()
  })

  it("answers a sizing failure as the service's own, with SIZING_FAILED", () => {
    expect(
      uploadRefusal({ sizingError: new Error('did not measure areas a1') })
    ).toEqual({
      errors: [
        {
          code: ERROR_CODES.SIZING_FAILED,
          message: 'Unable to calculate habitat sizes'
        }
      ],
      internal: true,
      reason: 'sizing failed for',
      message: 'did not measure areas a1'
    })
  })

  it('answers a schema failure with the metadata error', () => {
    const refusal = uploadRefusal({
      schemaError: { message: '"habitats" is required', details: [] }
    })

    expect(refusal).toMatchObject({
      internal: false,
      reason: 'document schema rejected'
    })
    expect(refusal.errors).toHaveLength(1)
  })

  it('passes a validation error through as it is', () => {
    const validationError = {
      code: ERROR_CODES.NO_DERIVED_BASELINE_HABITATS,
      message: 'no baseline area habitats'
    }

    expect(uploadRefusal({ validationError })).toMatchObject({
      errors: [validationError],
      internal: false,
      reason: 'upload rejected'
    })
  })
})
