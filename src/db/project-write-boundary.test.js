import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SANCTIONED_WRITER = 'db/persist-project.js'

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return javascriptFiles(path)
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : []
  })
}

function directProjectWrites(source) {
  return (
    /\.(?:insert|update|delete)\(\s*projects\s*\)/s.test(source) ||
    /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:bng\.)?projects\b/i.test(
      source
    )
  )
}

describe('auditable project write boundary', () => {
  test('all production project writes use the actor-aware persistence module', () => {
    const offenders = javascriptFiles(SRC_ROOT)
      .filter((path) => !path.endsWith('.test.js'))
      .filter((path) => directProjectWrites(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC_ROOT, path).replaceAll('\\', '/'))
      .filter((path) => path !== SANCTIONED_WRITER)

    expect(offenders).toEqual([])
  })
})
