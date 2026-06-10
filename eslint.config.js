import neostandard from 'neostandard'

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
  {
    files: ['bng-metric-engine/**/*.js'],
    languageOptions: {
      ecmaVersion: 2025,
      sourceType: 'module'
    }
  }
]
