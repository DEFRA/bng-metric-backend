import neostandard from 'neostandard'

// Path boundary messages — keep in sync with docs/CODE_STRUCTURE.md Guardrails.
const CODE_STRUCTURE_DOC = 'See docs/CODE_STRUCTURE.md.'
const MSG_ENRICHMENT_CROSS_FLOW = `Do not cross-import enrichment/baseline and enrichment/post-intervention. Shared adapters belong in enrichment/shared/. ${CODE_STRUCTURE_DOC}`
const MSG_SHARED_PIPELINE_FLOW = `Shared pipeline modules must not import flow-specific enrichment or status folders. Dispatch from upload orchestration, or use enrichment/shared/. ${CODE_STRUCTURE_DOC}`
const MSG_UPLOAD_STATUS_FOLDERS = `Upload orchestration may import flow enrichment (it dispatches on documentKey) but must not import services/baseline or services/post-intervention status modules. ${CODE_STRUCTURE_DOC}`
const MSG_EXTRACT_OTHER_FLOW = `GeoPackage extract/recompute modules may only use their own flow's enrichment and status folders (plus enrichment/shared/). ${CODE_STRUCTURE_DOC}`

function restrictedImportPatterns(patterns) {
  return {
    'no-restricted-imports': [
      'error',
      {
        patterns: patterns.map(({ regex, message }) => ({ regex, message }))
      }
    ]
  }
}

export default [
  ...neostandard({
    env: ['node', 'vitest'],
    ignores: [...neostandard.resolveIgnoresFromGitignore()],
    noJsx: true,
    noStyle: true
  }),
  {
    rules: {
      curly: ['error', 'all']
    }
  },
  {
    // The bng.projects.project JSONB document may only be written through
    // src/db/persist-project.js, which validates each fragment against the Joi
    // schema before persisting (keeps the data dictionary honest). Ban direct
    // drizzle writes to the `projects` table everywhere else so new routes have
    // to come through the validating choke point. See docs/DATA_DICTIONARY.md.
    files: ['src/**/*.js'],
    ignores: ['src/db/persist-project.js', 'src/**/*.test.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name=/^(insert|update)$/] > Identifier[name='projects']",
          message:
            'Write bng.projects only via src/db/persist-project.js (it validates against the Joi schema before persisting). See docs/DATA_DICTIONARY.md.'
        }
      ]
    }
  },

  // --- Code-structure path guardrails (ticket 10) -------------------------
  // Patterns match the import source string (not resolved paths). Cover both
  // deep relative forms (.../enrichment/baseline/...) and sibling forms
  // (../baseline/...) used inside enrichment/.

  {
    files: ['src/utilities/enrichment/baseline/**/*.js'],
    rules: restrictedImportPatterns([
      {
        regex: String.raw`enrichment/post-intervention/|\.\./post-intervention/`,
        message: MSG_ENRICHMENT_CROSS_FLOW
      }
    ])
  },
  {
    files: ['src/utilities/enrichment/post-intervention/**/*.js'],
    rules: restrictedImportPatterns([
      {
        regex: String.raw`enrichment/baseline/|\.\./baseline/`,
        message: MSG_ENRICHMENT_CROSS_FLOW
      }
    ])
  },
  {
    // Shared adapters must not reach into either flow's enrichment folder.
    files: ['src/utilities/enrichment/shared/**/*.js'],
    rules: restrictedImportPatterns([
      {
        regex: String.raw`enrichment/baseline/|\.\./baseline/`,
        message: MSG_ENRICHMENT_CROSS_FLOW
      },
      {
        regex: String.raw`enrichment/post-intervention/|\.\./post-intervention/`,
        message: MSG_ENRICHMENT_CROSS_FLOW
      }
    ])
  },
  {
    // Shared GeoPackage parse/validate root + validate-route factory: no
    // flow-specific enrichment or completeness-status modules.
    files: [
      'src/validation/geopackage/*.js',
      'src/routes/validate-geopackage-route.js'
    ],
    rules: restrictedImportPatterns([
      {
        regex: 'enrichment/baseline/',
        message: MSG_SHARED_PIPELINE_FLOW
      },
      {
        regex: 'enrichment/post-intervention/',
        message: MSG_SHARED_PIPELINE_FLOW
      },
      {
        regex: 'services/baseline/',
        message: MSG_SHARED_PIPELINE_FLOW
      },
      {
        regex: 'services/post-intervention/',
        message: MSG_SHARED_PIPELINE_FLOW
      }
    ])
  },
  {
    // Upload save/persist dispatches on documentKey so flow enrichment imports
    // are allowed; flow status folders are not. Match both deep
    // (.../services/baseline/...) and sibling (.../../baseline/...) forms.
    files: ['src/services/upload/**/*.js'],
    rules: restrictedImportPatterns([
      {
        regex: String.raw`services/baseline/|\.\./baseline/`,
        message: MSG_UPLOAD_STATUS_FOLDERS
      },
      {
        regex: String.raw`services/post-intervention/|\.\./post-intervention/`,
        message: MSG_UPLOAD_STATUS_FOLDERS
      }
    ])
  },
  {
    files: ['src/validation/geopackage/baseline/**/*.js'],
    rules: restrictedImportPatterns([
      {
        regex: String.raw`enrichment/post-intervention/|services/post-intervention/|\.\./post-intervention/`,
        message: MSG_EXTRACT_OTHER_FLOW
      }
    ])
  },
  {
    files: ['src/validation/geopackage/post-intervention/**/*.js'],
    rules: restrictedImportPatterns([
      {
        regex: String.raw`enrichment/baseline/|services/baseline/|\.\./baseline/`,
        message: MSG_EXTRACT_OTHER_FLOW
      }
    ])
  },

  {
    files: ['bng-metric-engine/**/*.js'],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module'
    }
  }
]
