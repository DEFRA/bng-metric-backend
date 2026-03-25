import { postgres } from './postgres.js'

vi.mock('pg-pool', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {}
    })
  }
})

vi.mock('@aws-sdk/rds-signer', () => ({
  Signer: vi.fn().mockImplementation(function () {
    this.getAuthToken = vi.fn().mockResolvedValue('mock-iam-token')
  })
}))

vi.mock('@aws-sdk/credential-providers', () => ({
  fromNodeProviderChain: vi.fn().mockReturnValue('mock-credentials')
}))

describe('#postgres plugin', () => {
  const mockServer = {
    logger: { info: vi.fn() },
    decorate: vi.fn(),
    secureContext: null
  }

  const baseOptions = {
    host: 'localhost',
    port: 5432,
    user: 'dev',
    database: 'bng',
    localPassword: 'dev',
    region: 'eu-west-2'
  }

  test('Should use local password when iamAuthentication is false', async () => {
    const Pool = (await import('pg-pool')).default
    let passwordFn

    Pool.mockImplementation(function (opts) {
      passwordFn = opts.password
      return this
    })

    postgres.plugin.register(mockServer, {
      ...baseOptions,
      iamAuthentication: false
    })

    expect(mockServer.decorate).toHaveBeenCalledWith(
      'server',
      'pg',
      expect.anything()
    )
    expect(mockServer.decorate).toHaveBeenCalledWith(
      'request',
      'pg',
      expect.anything()
    )
    expect(passwordFn()).toBe('dev')
  })

  test('Should return IAM token when iamAuthentication is true', async () => {
    const { Signer } = await import('@aws-sdk/rds-signer')

    const Pool = (await import('pg-pool')).default
    let passwordFn

    Pool.mockImplementation(function (opts) {
      passwordFn = opts.password
      return this
    })

    mockServer.decorate.mockReset()

    postgres.plugin.register(mockServer, {
      ...baseOptions,
      iamAuthentication: true
    })

    const token = await passwordFn()

    expect(Signer).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'localhost',
        port: 5432,
        username: 'dev'
      })
    )
    expect(token).toBe('mock-iam-token')
  })
})
