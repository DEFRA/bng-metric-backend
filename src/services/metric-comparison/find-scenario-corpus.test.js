import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { CORPUS_DIR_ENV, findScenarioCorpus } from './find-scenario-corpus.js'

describe('findScenarioCorpus', () => {
  const workspace = fs.mkdtempSync(path.join(tmpdir(), 'workspace-'))
  const backend = path.join(workspace, 'bng-metric-backend')
  fs.mkdirSync(backend)
  afterAll(() => fs.rmSync(workspace, { recursive: true, force: true }))

  function harness(name) {
    const dir = path.join(workspace, name)
    fs.mkdirSync(path.join(dir, 'example-files', 'permutations'), {
      recursive: true
    })
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'bng-metric-harness' })
    )
    return path.join(dir, 'example-files', 'permutations')
  }

  it('is none when there is no harness beside the repo', () => {
    expect(findScenarioCorpus({ env: {}, repoRoot: backend })).toBeNull()
  })

  it('prefers a folder named in the environment', () => {
    expect(
      findScenarioCorpus({
        env: { [CORPUS_DIR_ENV]: '/somewhere/else' },
        repoRoot: backend
      })
    ).toBe(path.resolve('/somewhere/else'))
  })

  it('finds the harness beside the repo by its package.json, whatever it is called', () => {
    const corpus = harness('my-harness')
    expect(findScenarioCorpus({ env: {}, repoRoot: backend })).toBe(corpus)
  })

  it('is none when the harness has no scenarios folder', () => {
    const lone = fs.mkdtempSync(path.join(tmpdir(), 'workspace-'))
    try {
      const repo = path.join(lone, 'bng-metric-backend')
      fs.mkdirSync(repo)
      const dir = path.join(lone, 'harness')
      fs.mkdirSync(dir)
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'bng-metric-harness' })
      )
      expect(findScenarioCorpus({ env: {}, repoRoot: repo })).toBeNull()
    } finally {
      fs.rmSync(lone, { recursive: true, force: true })
    }
  })
})
