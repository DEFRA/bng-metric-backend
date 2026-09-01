import { beforeEach, describe, expect, test, vi } from 'vitest'
import Hapi from '@hapi/hapi'

vi.mock('../services/report/fonts.js', () => ({
  loadReportFonts: vi.fn()
}))

const { reportFonts } = await import('./report-fonts.js')
const { loadReportFonts } = await import('../services/report/fonts.js')

const FONTS = {
  regular: Buffer.from('regular'),
  bold: Buffer.from('bold'),
  source: 's3'
}

beforeEach(() => {
  vi.mocked(loadReportFonts).mockReset()
})

describe('#reportFonts', () => {
  test('resolves the fonts once and hangs them on server.app', async () => {
    vi.mocked(loadReportFonts).mockResolvedValue(FONTS)
    const server = Hapi.server()

    await server.register(reportFonts)

    expect(server.app.reportFonts).toBe(FONTS)
    expect(loadReportFonts).toHaveBeenCalledTimes(1)
  })

  test('fails the boot when the configured fonts cannot be read', async () => {
    // The deliberate choice: a deployment told to use a privately held
    // typeface either has it before it serves a request, or does not start.
    // Falling back would render a document in the wrong typeface and say
    // nothing about it.
    vi.mocked(loadReportFonts).mockRejectedValue(
      new Error('Report fonts could not be read from s3://fonts: AccessDenied')
    )
    const server = Hapi.server()

    await expect(server.register(reportFonts)).rejects.toThrow('AccessDenied')
  })
})
