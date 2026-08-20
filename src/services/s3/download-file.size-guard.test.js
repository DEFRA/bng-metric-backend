import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * ContentLength is metadata S3 reports, not a promise it keeps: an object can
 * understate its size, or omit the header entirely. The streamed guard is what
 * actually bounds what reaches the disk, so it is exercised here against a
 * deliberately tiny configured limit rather than the real 100 MB one.
 */
const TEST_MAX_FILE_SIZE_BYTES = 32

vi.mock('./s3-client.js')
// Only the upload limit is overridden — everything else (logging, for one)
// still needs the real configuration.
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    config: {
      ...actual.config,
      get: (key) =>
        key === 'upload.maxFileSizeBytes'
          ? TEST_MAX_FILE_SIZE_BYTES
          : actual.config.get(key)
    }
  }
})

const { downloadFileToPath, S3FileTooLargeError, MAX_FILE_SIZE_BYTES } =
  await import('./download-file.js')
const { createS3Client } = await import('./s3-client.js')

const BUCKET = 'baseline-files'
const KEY = 'baseline/file.gpkg'

let downloadDir
let nextDestId = 0

beforeAll(() => {
  downloadDir = mkdtempSync(join(tmpdir(), 's3-size-guard-'))
})

afterAll(() => {
  rmSync(downloadDir, { recursive: true, force: true })
})

function destPath() {
  nextDestId += 1
  return join(downloadDir, `download-${nextDestId}.bin`)
}

/** Body that understates its size: no ContentLength, more bytes than allowed. */
function mockOversizedBody(chunks, extra = {}) {
  const send = vi.fn().mockResolvedValue({
    ...extra,
    Body: {
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) {
          yield chunk
        }
      }
    }
  })
  vi.mocked(createS3Client).mockReturnValue({ send })
  return send
}

describe('the streamed size guard', () => {
  it('takes its limit from the configured upload maximum', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(TEST_MAX_FILE_SIZE_BYTES)
  })

  it('fails an object that exceeds the limit despite advertising nothing', async () => {
    mockOversizedBody([Buffer.alloc(TEST_MAX_FILE_SIZE_BYTES + 1)])

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      S3FileTooLargeError
    )
  })

  it('fails an object that exceeds the limit only across several chunks', async () => {
    mockOversizedBody([Buffer.alloc(TEST_MAX_FILE_SIZE_BYTES), Buffer.alloc(1)])

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      S3FileTooLargeError
    )
  })

  it('fails an object whose ContentLength understated its real size', async () => {
    mockOversizedBody([Buffer.alloc(TEST_MAX_FILE_SIZE_BYTES + 1)], {
      ContentLength: 1
    })

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      S3FileTooLargeError
    )
  })

  it('leaves nothing on disk when it aborts a download mid-stream', async () => {
    mockOversizedBody([Buffer.alloc(TEST_MAX_FILE_SIZE_BYTES + 1)])
    const dest = destPath()

    await expect(downloadFileToPath(BUCKET, KEY, dest)).rejects.toThrow()

    expect(existsSync(dest)).toBe(false)
  })

  it('reports the bytes actually read in the error message', async () => {
    mockOversizedBody([Buffer.alloc(TEST_MAX_FILE_SIZE_BYTES + 1)])

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).rejects.toThrow(
      new RegExp(`${TEST_MAX_FILE_SIZE_BYTES + 1}`)
    )
  })

  it('allows an object exactly on the limit', async () => {
    mockOversizedBody([Buffer.alloc(TEST_MAX_FILE_SIZE_BYTES)])

    await expect(downloadFileToPath(BUCKET, KEY, destPath())).resolves.toEqual({
      bytes: TEST_MAX_FILE_SIZE_BYTES
    })
  })
})
