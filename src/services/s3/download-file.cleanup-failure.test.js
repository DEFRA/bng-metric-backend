import { vi, describe, it, expect } from 'vitest'

/**
 * The download already failed; failing to tidy up after it must not replace
 * the error the caller needs to see. `rm` is mocked module-wide here because
 * an ESM namespace export cannot be spied on in place.
 */
vi.mock('./s3-client.js')
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    rm: vi.fn().mockRejectedValue(new Error('EACCES'))
  }
})

const { downloadFileToTemp } = await import('./download-file.js')
const { createS3Client } = await import('./s3-client.js')
const { rm } = await import('node:fs/promises')

const BUCKET = 'baseline-files'
const KEY = 'baseline/file.gpkg'

async function* failMidStream() {
  yield Buffer.from('partial')
  throw new Error('socket hang up')
}

describe('downloadFileToTemp when tidying up after a failed download also fails', () => {
  it('surfaces the download error, not the cleanup error', async () => {
    const send = vi
      .fn()
      .mockResolvedValue({ Body: { [Symbol.asyncIterator]: failMidStream } })
    vi.mocked(createS3Client).mockReturnValue({ send })

    await expect(downloadFileToTemp(BUCKET, KEY)).rejects.toThrow(
      /socket hang up/
    )
    expect(rm).toHaveBeenCalled()
  })
})
