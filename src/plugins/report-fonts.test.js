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

  test('registers whatever the loader resolved, including a fallback', async () => {
    // An unreadable bucket degrades to the committed fonts inside the loader
    // (see services/report/fonts.js), so this plugin has nothing to catch and
    // a bucket outage never costs a boot.
    vi.mocked(loadReportFonts).mockResolvedValue({
      regular: Buffer.from('noto'),
      bold: Buffer.from('noto bold'),
      source: 'bundled'
    })
    const server = Hapi.server()

    await server.register(reportFonts)

    expect(server.app.reportFonts.source).toBe('bundled')
  })
})
