import { vi, describe, it, expect } from 'vitest'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'

/**
 * The Content-Length check is only the first guard. An object that arrives
 * without one — or understates its size — is caught by the running byte count
 * as it streams, so a malformed response cannot fill the disk. The limit is
 * shrunk to a handful of bytes here so the case is provable without moving
 * 100 MB.
 */
const TINY_MAX_BYTES = 8

vi.mock('./s3-client.js')
vi.mock('../../config.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    config: {
      get: (key) =>
        key === 'upload.maxFileSizeBytes'
          ? TINY_MAX_BYTES
          : actual.config.get(key),
      has: (key) => actual.config.has(key)
    }
  }
})

const { downloadFileToTemp, S3FileTooLargeError, MAX_FILE_SIZE_BYTES } =
  await import('./download-file.js')
const { createS3Client } = await import('./s3-client.js')

const BUCKET = 'baseline-files'
const KEY = 'baseline/file.gpkg'
const TEMP_DIR_PREFIX = 's3-download-'

function mockBody(chunks) {
  const send = vi.fn().mockResolvedValue({
    Body: {
      [Symbol.asyncIterator]: async function* () {
        for (const chunk of chunks) {
          yield chunk
        }
      }
    }
  })
  vi.mocked(createS3Client).mockReturnValue({ send })
}

async function downloadTempDirs() {
  const entries = await readdir(tmpdir())
  return entries.filter((name) => name.startsWith(TEMP_DIR_PREFIX))
}

describe('downloadFileToTemp streaming size guard', () => {
  it('takes its limit from the configured upload maximum', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(TINY_MAX_BYTES)
  })

  it('accepts a body that exactly reaches the limit', async () => {
    mockBody([Buffer.alloc(TINY_MAX_BYTES)])

    const result = await downloadFileToTemp(BUCKET, KEY)

    expect(result.size).toBe(TINY_MAX_BYTES)
    await result.cleanup()
  })

  it('rejects a body that overruns the limit, with no Content-Length to warn it', async () => {
    mockBody([Buffer.alloc(TINY_MAX_BYTES), Buffer.alloc(1)])

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      S3FileTooLargeError
    )
  })

  it('leaves no partial file behind when it overruns', async () => {
    mockBody([Buffer.alloc(TINY_MAX_BYTES), Buffer.alloc(1)])
    const before = await downloadTempDirs()

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      S3FileTooLargeError
    )

    const after = await downloadTempDirs()
    expect(after.filter((name) => !before.includes(name))).toEqual([])
  })
})
