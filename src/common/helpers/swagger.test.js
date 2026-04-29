import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockSpec = vi.hoisted(() => ({
  openapi: '3.0.0',
  info: { title: 'BNG Metric Backend API' }
}))

vi.mock('swagger-jsdoc', () => ({
  default: vi.fn(() => mockSpec)
}))

vi.mock('swagger-ui-dist/package.json', () => ({}), {
  virtual: true
})

const { swagger } = await import('./swagger.js')

describe('#swagger plugin', () => {
  let server
  let routes

  beforeEach(() => {
    routes = []
    server = {
      route: (route) => routes.push(route)
    }
    swagger.plugin.register(server)
  })

  test('Should have the expected plugin name', () => {
    expect(swagger.plugin.name).toBe('swagger')
  })

  test('Should register four routes', () => {
    expect(routes).toHaveLength(4)
  })

  describe('GET /swagger.json', () => {
    test('Should return the swagger spec', () => {
      const route = routes.find((r) => r.path === '/swagger.json')
      expect(route.method).toBe('GET')

      const mockH = { response: vi.fn() }
      route.handler({}, mockH)
      expect(mockH.response).toHaveBeenCalledWith(mockSpec)
    })
  })

  describe('GET /docs/{param*}', () => {
    test('Should serve swagger-ui-dist directory', () => {
      const route = routes.find((r) => r.path === '/docs/{param*}')
      expect(route.method).toBe('GET')
      expect(route.handler.directory).toEqual(
        expect.objectContaining({ index: ['index.html'] })
      )
    })
  })

  describe('GET /docs', () => {
    test('Should redirect to /docs/index.html', () => {
      const route = routes.find((r) => r.path === '/docs')
      expect(route.method).toBe('GET')

      const mockH = { redirect: vi.fn() }
      route.handler({}, mockH)
      expect(mockH.redirect).toHaveBeenCalledWith('/docs/index.html')
    })
  })

  describe('GET /docs/swagger-initializer.js', () => {
    test('Should return JavaScript that points at /swagger.json', () => {
      const route = routes.find(
        (r) => r.path === '/docs/swagger-initializer.js'
      )
      expect(route.method).toBe('GET')

      const mockType = vi.fn()
      const mockH = { response: vi.fn(() => ({ type: mockType })) }
      route.handler({}, mockH)

      const body = mockH.response.mock.calls[0][0]
      expect(body).toContain('/swagger.json')
      expect(body).toContain('SwaggerUIBundle')
      expect(mockType).toHaveBeenCalledWith('application/javascript')
    })
  })
})
