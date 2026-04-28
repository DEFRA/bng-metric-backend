import { describe, test, expect } from 'vitest'
import { projects, auditLog, geometry } from './index.js'

describe('db/schema barrel export', () => {
  test('Should export projects table', () => {
    expect(projects).toBeDefined()
  })

  test('Should export auditLog table', () => {
    expect(auditLog).toBeDefined()
  })

  test('Should export geometry custom type', () => {
    expect(geometry).toBeDefined()
    expect(typeof geometry).toBe('function')
  })
})
