import { describe, expect, test, vi } from 'vitest'

import { buildMetricWorkbook } from './build-metric-workbook.js'

vi.mock('bng-library/workbook-writer', async (importOriginal) => ({
  ...(await importOriginal()),
  writeMetricWorkbook: vi.fn(() => Buffer.from('PK'))
}))

const { writeMetricWorkbook } = await import('bng-library/workbook-writer')

const project = {
  name: 'Riverside Farm',
  details: {
    localPlanningAuthority: 'Riverside District Council',
    applicant: 'Riverside Homes Ltd',
    planningApplicationType: 'Outline',
    planningApplicationReference: 'RDC/24/0001'
  },
  baseline: { habitats: [] }
}

async function detailsWritten(options) {
  await buildMetricWorkbook(project, { format: 'xlsx', ...options })
  return writeMetricWorkbook.mock.lastCall[0].details
}

describe('the Start sheet details buildMetricWorkbook writes', () => {
  test('are the project’s, with "Completed by" left for the user', async () => {
    expect(
      await detailsWritten({ now: new Date('2026-11-03T10:00:00Z') })
    ).toEqual({
      planningAuthority: 'Riverside District Council',
      projectName: 'Riverside Farm',
      applicant: 'Riverside Homes Ltd',
      applicationType: 'Outline',
      planningApplicationReference: 'RDC/24/0001',
      completionDate: '2026-11-03'
    })
  })

  test('date the metric on the London day, not the UTC one', async () => {
    // 23:30 UTC on 30 June is already 1 July in British Summer Time.
    const details = await detailsWritten({
      now: new Date('2026-06-30T23:30:00Z')
    })

    expect(details.completionDate).toBe('2026-07-01')
  })

  test('leave out what the project does not have', async () => {
    await buildMetricWorkbook(
      { baseline: { habitats: [] } },
      { format: 'xlsx', now: new Date('2026-11-03T10:00:00Z') }
    )

    expect(writeMetricWorkbook.mock.lastCall[0].details).toEqual({
      planningAuthority: null,
      projectName: null,
      applicant: null,
      applicationType: null,
      planningApplicationReference: null,
      completionDate: '2026-11-03'
    })
  })
})
