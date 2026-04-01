import { vi } from 'vitest'
import { createDrizzle } from './index.js'

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({ mockDrizzleInstance: true })
}))

describe('#createDrizzle', () => {
  test('Should create a drizzle instance from a pool', async () => {
    const { drizzle } = await import('drizzle-orm/node-postgres')
    const mockPool = { connect: vi.fn() }

    const db = createDrizzle(mockPool)

    expect(drizzle).toHaveBeenCalledWith(mockPool, {
      schema: expect.any(Object)
    })
    expect(db).toEqual({ mockDrizzleInstance: true })
  })
})
