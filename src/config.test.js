describe('#config', () => {
  test('Should default to non-production settings', async () => {
    const { config } = await import('./config.js')

    expect(config.get('log.format')).toBe('pino-pretty')
    expect(config.get('log.redact')).toEqual(['req', 'res', 'responseTime'])
    expect(config.get('isMetricsEnabled')).toBe(false)
    expect(config.get('postgres.iamAuthentication')).toBe(false)
  })

  test('Should default to production settings when NODE_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    vi.resetModules()

    const { config } = await import('./config.js')

    expect(config.get('log.format')).toBe('ecs')
    expect(config.get('log.redact')).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers'
    ])
    expect(config.get('isMetricsEnabled')).toBe(true)
    expect(config.get('postgres.iamAuthentication')).toBe(true)

    vi.unstubAllEnvs()
  })
})
