import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import hapi from '@hapi/hapi'
import Database from 'better-sqlite3'

vi.mock('../../plugins/postgres.js', () => ({
  postgres: {
    plugin: {
      name: 'postgres',
      version: '1.0.0',
      register: vi.fn()
    }
  }
}))

vi.mock('better-sqlite3', () => ({
  default: vi.fn(function () {
    return { close: vi.fn() }
  })
}))

describe('#startServer', () => {
  let createServerSpy
  let hapiServerSpy
  let startServerImport
  let createServerImport

  beforeAll(async () => {
    vi.stubEnv('PORT', '0')

    createServerImport = await import('../../server.js')
    startServerImport = await import('./start-server.js')

    createServerSpy = vi.spyOn(createServerImport, 'createServer')
    hapiServerSpy = vi.spyOn(hapi, 'server')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  describe('When server starts', () => {
    let server

    afterAll(async () => {
      await server.stop({ timeout: 0 })
    })

    test('Should start up server as expected', async () => {
      server = await startServerImport.startServer()

      expect(createServerSpy).toHaveBeenCalled()
      expect(hapiServerSpy).toHaveBeenCalled()
    })
  })

  describe('When server start fails', () => {
    test('Should log failed startup message', async () => {
      createServerSpy.mockRejectedValue(new Error('Server failed to start'))

      await expect(startServerImport.startServer()).rejects.toThrow(
        'Server failed to start'
      )
    })
  })

  describe('better-sqlite3 native-binding smoke check', () => {
    test('Throws an actionable rebuild message when the binding is mismatched', async () => {
      vi.mocked(Database).mockImplementationOnce(function () {
        throw new Error(
          "The module 'better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 137."
        )
      })

      await expect(startServerImport.startServer()).rejects.toThrow(
        /better-sqlite3 native binding mismatches.*npm rebuild better-sqlite3/s
      )
    })

    test('Re-throws unexpected errors unchanged', async () => {
      vi.mocked(Database).mockImplementationOnce(function () {
        throw new Error('disk full')
      })

      await expect(startServerImport.startServer()).rejects.toThrow('disk full')
    })
  })
})
