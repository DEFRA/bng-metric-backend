import { describe, it, expect, vi, afterEach } from 'vitest'

const writeFileSyncSpy = vi.fn()

// better-sqlite3 needs real writeFileSync/mkdtempSync/rmSync to actually
// stage the WAL-mode fallback file, so this passes every call through to
// the real implementation — it only adds a spy around writeFileSync to
// observe whether validateGpkg used the disk-staging path at all.
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

const { ALL_LAYERS, GP10_APP_ID, buildBuffer, buildWalModeBuffer } =
  await import('../../../test/helpers/baseline-geopackage.js')

const { validateGpkg } = await import('./geopackage.js')

// Regression coverage for the in-memory fast path: validateGpkg should only
// pay the disk-staging cost (writeFileSync) for buffers the fast path can't
// service (WAL-mode GeoPackages), not for the common case.
describe('validateGpkg fast path vs disk-staging fallback', () => {
  afterEach(() => {
    writeFileSyncSpy.mockClear()
  })

  it('validates a regular GeoPackage buffer without staging it to disk', () => {
    const result = validateGpkg(
      buildBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
    expect(writeFileSyncSpy).not.toHaveBeenCalled()
  })

  it('stages a WAL-mode GeoPackage buffer to disk (header gate skips the probe)', () => {
    const result = validateGpkg(
      buildWalModeBuffer({
        appId: GP10_APP_ID,
        systemTables: true,
        featureLayers: ALL_LAYERS
      })
    )

    expect(result).toEqual({ valid: true, errors: [] })
    expect(writeFileSyncSpy).toHaveBeenCalledTimes(1)
  })

  it('rejects a non-SQLite buffer without staging it to disk', () => {
    const result = validateGpkg(Buffer.from('this is not a database'))

    expect(result.valid).toBe(false)
    expect(writeFileSyncSpy).not.toHaveBeenCalled()
  })
})
