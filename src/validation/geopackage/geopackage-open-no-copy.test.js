import { describe, it, expect, vi, afterEach, afterAll } from 'vitest'

const writeFileSyncSpy = vi.fn()

// The validator must open the staged upload where it lies. Passing every call
// through to the real implementation keeps better-sqlite3 and the fixture
// helpers working, and adds a spy around writeFileSync so the tests can see
// whether anything copied the file.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    writeFileSync: (...args) => {
      writeFileSyncSpy(...args)
      return actual.writeFileSync(...args)
    }
  }
})

const {
  ALL_LAYERS,
  GP10_APP_ID,
  buildBuffer,
  buildWalModeBuffer,
  removeStagedGpkgFiles,
  stageGpkgFile
} = await import('../../../test/helpers/gpkg.js')

const { validateAndReadGpkg } = await import('./geopackage.js')

/** Stage the fixture, then start counting — only the validator's own writes matter. */
function stageThenWatch(buffer) {
  const filePath = stageGpkgFile(buffer)
  writeFileSyncSpy.mockClear()
  return filePath
}

// Regression coverage for BMD-913: validation holds no copy of the upload.
// Before, the file could exist as an S3 Buffer, a staged copy written by the
// validator and a second copy written by the route, all at once.
describe('validateAndReadGpkg opens the staged upload without copying it', () => {
  afterEach(() => {
    writeFileSyncSpy.mockClear()
  })

  afterAll(removeStagedGpkgFiles)

  it('validates a GeoPackage in place', () => {
    const filePath = stageThenWatch(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      })
    )

    const result = validateAndReadGpkg(filePath)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(writeFileSyncSpy).not.toHaveBeenCalled()
  })

  it('validates a WAL-mode GeoPackage in place too', () => {
    // WAL-mode headers used to force a disk-staging fallback, because
    // sqlite3_deserialize cannot open them. Opening the file directly needs
    // no such special case.
    const filePath = stageThenWatch(
      buildWalModeBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      })
    )

    const result = validateAndReadGpkg(filePath)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(writeFileSyncSpy).not.toHaveBeenCalled()
  })

  it('rejects a file that is not a database without copying it', () => {
    const filePath = stageThenWatch(Buffer.from('this is not a database'))

    expect(validateAndReadGpkg(filePath).valid).toBe(false)
    expect(writeFileSyncSpy).not.toHaveBeenCalled()
  })
})
