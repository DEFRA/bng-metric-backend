import { describe, test, expect, vi } from 'vitest'
import { dbInfo } from './db-info.js'

describe('#dbInfo', () => {
  test('Should query postgres and return version', async () => {
    const mockVersion = 'PostgreSQL 16.1'
    const request = {
      pg: {
        query: vi.fn().mockResolvedValue({
          rows: [{ version: mockVersion }]
        })
      }
    }

    const result = await dbInfo.handler(request, {})

    expect(request.pg.query).toHaveBeenCalledWith('SELECT version()')
    expect(result).toEqual({ version: mockVersion })
  })
})
