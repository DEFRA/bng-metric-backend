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

const savedEnv = { ...process.env }

beforeEach(() => {
  vi.spyOn(config, 'get')
})

afterEach(() => {
  process.env = { ...savedEnv }
})

describe('createS3Client', () => {
  describe('in local environment', () => {
    beforeEach(() => {
      vi.mocked(config.get).mockReturnValue('local')
    })

    it('creates an S3Client pointing at the default localstack endpoint', () => {
      delete process.env.AWS_ENDPOINT_URL

      createS3Client()

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'http://localhost:4566',
          forcePathStyle: true
        })
      )
    })

    it('uses AWS_ENDPOINT_URL when set', () => {
      process.env.AWS_ENDPOINT_URL = 'http://custom-localstack:4566'

      createS3Client()

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: 'http://custom-localstack:4566' })
      )
    })

    it('uses the default eu-west-2 region when AWS_REGION is not set', () => {
      delete process.env.AWS_REGION

      createS3Client()

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'eu-west-2' })
      )
    })

    it('uses AWS_REGION when set', () => {
      process.env.AWS_REGION = 'us-east-1'

      createS3Client()

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'us-east-1' })
      )
    })

    it('uses hardcoded test credentials when env vars are absent', () => {
      delete process.env.AWS_ACCESS_KEY_ID
      delete process.env.AWS_SECRET_ACCESS_KEY

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

    it('uses AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY when set', () => {
      process.env.AWS_ACCESS_KEY_ID = 'my-key'
      process.env.AWS_SECRET_ACCESS_KEY = 'my-secret'

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

  describe('in a non-local environment', () => {
    beforeEach(() => {
      vi.mocked(config.get).mockReturnValue('dev')
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
      delete process.env.AWS_REGION

      createS3Client()

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({ region: 'eu-west-2' })
      )
    })

    it('uses AWS_REGION when set', () => {
      process.env.AWS_REGION = 'eu-west-1'

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
})
