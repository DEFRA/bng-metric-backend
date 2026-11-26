import { describe, expect, test, vi } from 'vitest'

import { getProjectMetricWorkbook } from './metric-workbook.js'

vi.mock('../services/metric-workbook/build-in-worker.js', async () => {
  const actual = await vi.importActual(
    '../services/metric-workbook/build-in-worker.js'
  )
  return { ...actual, buildMetricWorkbookInWorker: vi.fn() }
})

const { MetricWorkbookBusyError, buildMetricWorkbookInWorker } =
  await import('../services/metric-workbook/build-in-worker.js')

const PROJECT_ID = '3f1e45b4-2e81-4c70-8a70-083ad958c913'
const WORKBOOK = Buffer.from('PK pretend workbook')
const HTTP_NOT_FOUND = 404
const HTTP_SERVICE_UNAVAILABLE = 503

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

function request(rows, format = 'xlsm') {
  return {
    params: { projectId: PROJECT_ID, format },
    auth: { credentials: { sub: 'user-1' } },
    drizzle: mockDrizzle(rows),
    logger: { info: vi.fn(), warn: vi.fn() }
  }
}

const project = { name: 'Riverside Farm', baseline: { habitats: [] } }

describe('#getProjectMetricWorkbook', () => {
  test('is an authenticated GET at /projects/{projectId}/metric.{format}', () => {
    expect(getProjectMetricWorkbook.method).toBe('GET')
    expect(getProjectMetricWorkbook.path).toBe(
      '/projects/{projectId}/metric.{format}'
    )
    expect(getProjectMetricWorkbook.options.auth).toBe('defra-jwt')
  })

  test.each([
    ['xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12'],
    [
      'xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
  ])('returns the %s workbook as its own type', async (format, type) => {
    buildMetricWorkbookInWorker.mockResolvedValue(WORKBOOK)
    const h = mockResponse()

    await getProjectMetricWorkbook.handler(request([{ project }], format), h)

    expect(buildMetricWorkbookInWorker).toHaveBeenCalledWith(project, {
      format
    })
    expect(h.response).toHaveBeenCalledWith(WORKBOOK)
    expect(h._response.type).toHaveBeenCalledWith(type)
    expect(h._response.header).toHaveBeenCalledWith(
      'content-disposition',
      `attachment; filename="metric.${format}"`
    )
  })

  test('logs the project, the format, the time and the size, and nothing about the user', async () => {
    buildMetricWorkbookInWorker.mockResolvedValue(WORKBOOK)
    const req = request([{ project }], 'xlsx')

    await getProjectMetricWorkbook.handler(req, mockResponse())

    expect(req.logger.info).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        format: 'xlsx',
        metricRelease: '1.1.1',
        ms: expect.any(Number),
        bytes: WORKBOOK.length
      },
      'metric workbook generated'
    )
  })

  test('404s for a project the user cannot see', async () => {
    await expect(
      getProjectMetricWorkbook.handler(request([]), mockResponse())
    ).rejects.toMatchObject({ output: { statusCode: HTTP_NOT_FOUND } })
  })

  test('404s for a project with no baseline (BMD-1141 AC11)', async () => {
    buildMetricWorkbookInWorker.mockClear()

    await expect(
      getProjectMetricWorkbook.handler(
        request([{ project: { name: 'Riverside Farm' } }]),
        mockResponse()
      )
    ).rejects.toMatchObject({ output: { statusCode: HTTP_NOT_FOUND } })
    expect(buildMetricWorkbookInWorker).not.toHaveBeenCalled()
  })

  test('lets a failure to build the workbook through, so nothing partial is sent (BMD-1141 AC13)', async () => {
    buildMetricWorkbookInWorker.mockRejectedValue(new Error('too many rows'))
    const h = mockResponse()

    await expect(
      getProjectMetricWorkbook.handler(request([{ project }]), h)
    ).rejects.toThrow('too many rows')
    expect(h.response).not.toHaveBeenCalled()
  })

  test('answers a 503 with a Retry-After when every build slot stays busy', async () => {
    buildMetricWorkbookInWorker.mockRejectedValue(
      new MetricWorkbookBusyError(4000)
    )
    const req = request([{ project }])
    const h = mockResponse()

    await expect(
      getProjectMetricWorkbook.handler(req, h)
    ).rejects.toMatchObject({
      output: {
        statusCode: HTTP_SERVICE_UNAVAILABLE,
        headers: { 'Retry-After': '5' }
      }
    })
    expect(h.response).not.toHaveBeenCalled()
    expect(req.logger.warn).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, format: 'xlsm' },
      'metric workbook refused: every build slot was busy'
    )
  })

  test('accepts only the two formats it makes', () => {
    const { params } = getProjectMetricWorkbook.options.validate
    for (const format of ['xlsm', 'xlsx']) {
      expect(
        params.validate({ projectId: PROJECT_ID, format }).error
      ).toBeUndefined()
    }
    const refused = params.validate({ projectId: PROJECT_ID, format: 'xls' })
    expect(refused.error).toBeDefined()
  })
})
