import { customType } from 'drizzle-orm/pg-core'

vi.mock('drizzle-orm/pg-core', () => ({
  customType: vi.fn((config) => config)
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal()
  return actual
})

const { geometry } = await import('./custom-types.js')

describe('#geometry', () => {
  test('Should pass config to customType', () => {
    geometry('Polygon', 27700)
    expect(customType).toHaveBeenCalledWith(
      expect.objectContaining({
        dataType: expect.any(Function),
        toDriver: expect.any(Function),
        fromDriver: expect.any(Function)
      })
    )
  })

  test('dataType should return the geometry type string', () => {
    const config = geometry('Polygon', 27700)
    expect(config.dataType()).toBe('geometry(Polygon, 27700)')
  })

  test('dataType should use provided type and SRID', () => {
    const config = geometry('Point', 4326)
    expect(config.dataType()).toBe('geometry(Point, 4326)')
  })

  test('fromDriver should return the value unchanged', () => {
    const config = geometry('Polygon', 27700)
    const geojson = { type: 'Polygon', coordinates: [[[0, 0]]] }
    expect(config.fromDriver(geojson)).toBe(geojson)
  })

  test('toDriver should return a SQL expression', () => {
    const config = geometry('Polygon', 27700)
    const geojson = { type: 'Polygon', coordinates: [[[0, 0]]] }
    const result = config.toDriver(geojson)
    expect(result).toBeDefined()
  })
})
