vi.mock('./s3-client.js')

const { downloadFile, S3TimeoutError, S3ConnectionError, DEFAULT_TIMEOUT_MS } =
  await import('./download-file.js')
const { createS3Client } = await import('./s3-client.js')

const BUCKET = 'baseline-files'
const KEY = 'baseline/file.gpkg'

/** Build an async-iterable body from an array of Buffer chunks. */
function makeBody(chunks) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk
    }
  }
}

/** Build an Error with the given name (simulates DOMException timeout/abort). */
function namedError(name, message = name) {
  const err = new Error(message)
  err.name = name
  return err
}

function mockSendWith(result) {
  const send = vi.fn().mockResolvedValue(result)
  vi.mocked(createS3Client).mockReturnValue({ send })
  return send
}

function mockSendRejecting(error) {
  const send = vi.fn().mockRejectedValue(error)
  vi.mocked(createS3Client).mockReturnValue({ send })
  return send
}

describe('DEFAULT_TIMEOUT_MS', () => {
  it('is 30 seconds', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000)
  })
})

describe('downloadFile', () => {
  describe('successful download', () => {
    it('concatenates body chunks and returns a Buffer', async () => {
      const chunk1 = Buffer.from('hello ')
      const chunk2 = Buffer.from('world')
      mockSendWith({ Body: makeBody([chunk1, chunk2]) })

      const result = await downloadFile(BUCKET, KEY)

      expect(result).toBeInstanceOf(Buffer)
      expect(result.toString()).toBe('hello world')
    })

    it('returns an empty Buffer when the body has no chunks', async () => {
      mockSendWith({ Body: makeBody([]) })

      const result = await downloadFile(BUCKET, KEY)

      expect(result).toBeInstanceOf(Buffer)
      expect(result.byteLength).toBe(0)
    })

    it('passes the abortSignal through to client.send', async () => {
      const send = mockSendWith({ Body: makeBody([Buffer.from('ok')]) })

      await downloadFile(BUCKET, KEY)

      const [, options] = send.mock.calls[0]
      expect(options).toHaveProperty('abortSignal')
    })
  })

  describe('when client.send throws a timeout', () => {
    it('throws S3TimeoutError for a TimeoutError', async () => {
      mockSendRejecting(namedError('TimeoutError'))

      await expect(downloadFile(BUCKET, KEY)).rejects.toThrow(S3TimeoutError)
    })

    it('throws S3TimeoutError for an AbortError', async () => {
      mockSendRejecting(namedError('AbortError'))

      await expect(downloadFile(BUCKET, KEY)).rejects.toThrow(S3TimeoutError)
    })

    it('includes bucket and key in the S3TimeoutError message', async () => {
      mockSendRejecting(namedError('TimeoutError'))

      await expect(downloadFile(BUCKET, KEY)).rejects.toThrow(
        new RegExp(`${BUCKET}.*${KEY}|${KEY}.*${BUCKET}`)
      )
    })
  })

  describe('when client.send throws a connection error', () => {
    it('throws S3ConnectionError for a generic error', async () => {
      mockSendRejecting(new Error('ECONNREFUSED'))

      await expect(downloadFile(BUCKET, KEY)).rejects.toThrow(S3ConnectionError)
    })

    it('includes the original message in the S3ConnectionError', async () => {
      mockSendRejecting(new Error('NoSuchKey'))

      await expect(downloadFile(BUCKET, KEY)).rejects.toThrow(/NoSuchKey/)
    })
  })

  describe('when the body stream throws a timeout', () => {
    it('throws S3TimeoutError for a TimeoutError during streaming', async () => {
      async function* failWithTimeout() {
        yield Buffer.from('partial')
        throw namedError('TimeoutError')
      }
      mockSendWith({ Body: { [Symbol.asyncIterator]: failWithTimeout } })

      await expect(downloadFile(BUCKET, KEY)).rejects.toThrow(S3TimeoutError)
    })

    it('throws S3TimeoutError for an AbortError during streaming', async () => {
      async function* failWithAbort() {
        throw namedError('AbortError')
      }
      mockSendWith({ Body: { [Symbol.asyncIterator]: failWithAbort } })

      await expect(downloadFile(BUCKET, KEY)).rejects.toThrow(S3TimeoutError)
    })
  })

  describe('when the body stream throws a connection error', () => {
    it('throws S3ConnectionError for a generic stream error', async () => {
      async function* failWithError() {
        throw new Error('socket hang up')
      }
      mockSendWith({ Body: { [Symbol.asyncIterator]: failWithError } })

      await expect(downloadFile(BUCKET, KEY)).rejects.toThrow(S3ConnectionError)
    })

    it('includes the original message in the S3ConnectionError', async () => {
      async function* failWithError() {
        throw new Error('socket hang up')
      }
      mockSendWith({ Body: { [Symbol.asyncIterator]: failWithError } })

      await expect(downloadFile(BUCKET, KEY)).rejects.toThrow(/socket hang up/)
    })
  })

  describe('custom timeoutMs option', () => {
    it('accepts a custom timeout and still succeeds', async () => {
      mockSendWith({ Body: makeBody([Buffer.from('data')]) })

      const result = await downloadFile(BUCKET, KEY, { timeoutMs: 5_000 })

      expect(result.toString()).toBe('data')
    })
  })
})
