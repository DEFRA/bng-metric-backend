import { describe, expect, test, vi } from 'vitest'

import { getProjectReport, reportFilename } from './report.js'

vi.mock('../services/report/build-site-report.js', () => ({
  buildSiteReport: vi.fn()
}))

const { buildSiteReport } =
  await import('../services/report/build-site-report.js')

const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const PDF = Buffer.from('%PDF-1.5 pretend')

// select().from().where().limit()
function mockDrizzle(rows) {
  const limit = vi.fn().mockResolvedValue(rows)
  const where = vi.fn().mockReturnValue({ limit })
  const from = vi.fn().mockReturnValue({ where })
  return { select: vi.fn().mockReturnValue({ from }) }
}

function mockResponse() {
  const response = {}
  response.header = vi.fn().mockReturnValue(response)
  response.type = vi.fn().mockReturnValue(response)
  return { response: vi.fn().mockReturnValue(response), _response: response }
}

function request(rows, { osTiles = null } = {}) {
  return {
    params: { projectId: PROJECT_ID },
    auth: { credentials: { sub: 'user-1' } },
    drizzle: mockDrizzle(rows),
    logger: { info: vi.fn() },
    server: { app: { osTiles } }
  }
}

const projectRow = {
  id: PROJECT_ID,
  project: { name: 'Test Farm', baseline: { habitats: [] } }
}

describe('#getProjectReport', () => {
  test('is a GET at /projects/{projectId}/report.pdf', () => {
    expect(getProjectReport.method).toBe('GET')
    expect(getProjectReport.path).toBe('/projects/{projectId}/report.pdf')
  })

  test('returns the PDF as an attachment named after the site', async () => {
    buildSiteReport.mockResolvedValue({
      pdf: PDF,
      stats: { maps: 1, tiles: 0, habitats: 2, zooms: [] },
      siteName: 'Test Farm'
    })
    const h = mockResponse()

    await getProjectReport.handler(request([projectRow]), h)

    expect(h.response).toHaveBeenCalledWith(PDF)
    expect(h._response.type).toHaveBeenCalledWith('application/pdf')
    expect(h._response.header).toHaveBeenCalledWith(
      'content-disposition',
      'attachment; filename="Test Farm-report.pdf"'
    )
  })

  test('logs what the report cost to produce', async () => {
    buildSiteReport.mockResolvedValue({
      pdf: PDF,
      stats: { maps: 2, tiles: 44, habitats: 20, zooms: [11, 11] },
      siteName: 'Test Farm'
    })
    const req = request([projectRow])

    await getProjectReport.handler(req, mockResponse())

    expect(req.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        bytes: PDF.length,
        tiles: 44,
        habitats: 20
      }),
      'site report generated'
    )
  })

  test('404s for a project the user cannot see', async () => {
    // A project belonging to someone else is indistinguishable from a missing
    // one — visibleToUser is applied in the same query.
    await expect(
      getProjectReport.handler(request([]), mockResponse())
    ).rejects.toMatchObject({ output: { statusCode: 404 } })

    expect(buildSiteReport).not.toHaveBeenCalled()
  })

  test('404s for a project with no baseline, rather than an empty report', async () => {
    const withoutBaseline = { id: PROJECT_ID, project: { name: 'Test Farm' } }

    await expect(
      getProjectReport.handler(request([withoutBaseline]), mockResponse())
    ).rejects.toMatchObject({ output: { statusCode: 404 } })

    expect(buildSiteReport).not.toHaveBeenCalled()
  })

  test('passes the OS tiles service through when the deployment has one', async () => {
    buildSiteReport.mockResolvedValue({
      pdf: PDF,
      stats: {},
      siteName: 'Test Farm'
    })
    const osTiles = { getTile: vi.fn() }

    await getProjectReport.handler(
      request([projectRow], { osTiles }),
      mockResponse()
    )

    expect(buildSiteReport).toHaveBeenCalledWith(
      expect.objectContaining({ osTiles })
    )
  })
})

describe('#reportFilename', () => {
  test('uses the site name', () => {
    expect(reportFilename('Test Farm')).toBe('Test Farm-report.pdf')
  })

  test('replaces rather than strips awkward characters, so names stay distinct', () => {
    // Stripping would collapse "A/B" and "AB" onto one filename.
    expect(reportFilename('A/B')).toBe('A-B-report.pdf')
    expect(reportFilename('AB')).toBe('AB-report.pdf')
  })

  test('cannot be used to break out of the content-disposition header', () => {
    expect(reportFilename('evil"; filename="x')).toBe(
      'evil-- filename--x-report.pdf'
    )
  })

  test('falls back to a generic name when nothing usable is left', () => {
    expect(reportFilename('///')).toBe('bng-site-report.pdf')
    expect(reportFilename(null)).toBe('bng-site-report.pdf')
  })

  test('caps the length', () => {
    expect(reportFilename('x'.repeat(500)).length).toBeLessThan(100)
  })
})
