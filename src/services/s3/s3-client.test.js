import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn()
}))

vi.mock('@aws-sdk/credential-providers', () => ({
  fromNodeProviderChain: vi
    .fn()
    .mockReturnValue('mock-provider-chain-credentials')
}))

const { S3Client } = await import('@aws-sdk/client-s3')
const { fromNodeProviderChain } = await import('@aws-sdk/credential-providers')
const { config } = await import('../../config.js')
const { createS3Client } = await import('./s3-client.js')

const AWS_DEFAULTS = {
  'aws.region': 'eu-west-2',
  'aws.endpointUrl': null,
  'aws.accessKeyId': 'test',
  'aws.secretAccessKey': 'test'
}

function mockConfig(overrides = {}) {
  const values = { ...AWS_DEFAULTS, ...overrides }
  vi.mocked(config.get).mockImplementation((key) => values[key] ?? null)
}

beforeEach(() => {
  vi.spyOn(config, 'get')
})

describe('createS3Client in local environment', () => {
  beforeEach(() => {
    mockConfig({ cdpEnvironment: 'local' })
  })

  it('creates an S3Client pointing at the default localstack endpoint when endpointUrl is not set', () => {
    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://localhost:4566',
        forcePathStyle: true
      })
    )
  })

  it('uses aws.endpointUrl when set', () => {
    // NOSONAR: LocalStack uses HTTP intentionally in local dev
    mockConfig({
      cdpEnvironment: 'local',
      'aws.endpointUrl': 'http://custom-localstack:4566'
    })

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      // NOSONAR: LocalStack uses HTTP intentionally in local dev
      expect.objectContaining({ endpoint: 'http://custom-localstack:4566' })
    )
  })

  it('uses the default eu-west-2 region', () => {
    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'eu-west-2' })
    )
  })

  it('uses aws.region when set', () => {
    mockConfig({ cdpEnvironment: 'local', 'aws.region': 'us-east-1' })

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east-1' })
    )
  })

  it('uses the default test credentials when accessKeyId and secretAccessKey are not overridden', () => {
    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          accessKeyId: 'test',
          secretAccessKey: 'test'
        }
      })
    )
  })

  it('uses aws.accessKeyId and aws.secretAccessKey when set', () => {
    mockConfig({
      cdpEnvironment: 'local',
      'aws.accessKeyId': 'my-key',
      'aws.secretAccessKey': 'my-secret'
    })

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: {
          accessKeyId: 'my-key',
          secretAccessKey: 'my-secret'
        }
      })
    )
  })

  it('does not use fromNodeProviderChain', () => {
    createS3Client()

    expect(fromNodeProviderChain).not.toHaveBeenCalled()
  })
})

describe('createS3Client in a non-local environment', () => {
  beforeEach(() => {
    mockConfig({ cdpEnvironment: 'dev' })
  })

  it('creates an S3Client using the node provider chain', () => {
    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: 'mock-provider-chain-credentials'
      })
    )
    expect(fromNodeProviderChain).toHaveBeenCalled()
  })

  it('uses the default eu-west-2 region', () => {
    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'eu-west-2' })
    )
  })

  it('uses aws.region when set', () => {
    mockConfig({ cdpEnvironment: 'dev', 'aws.region': 'eu-west-1' })

    createS3Client()

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'eu-west-1' })
    )
  })

  it('does not set a localstack endpoint or forcePathStyle', () => {
    createS3Client()

    expect(S3Client).not.toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: expect.anything() })
    )
    expect(S3Client).not.toHaveBeenCalledWith(
      expect.objectContaining({ forcePathStyle: true })
    )
  })
})
