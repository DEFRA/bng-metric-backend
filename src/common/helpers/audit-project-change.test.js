import { audit } from '@defra/cdp-auditing'

import {
  auditProjectChange,
  PROJECT_AUDIT_EVENT
} from './audit-project-change.js'

vi.mock('@defra/cdp-auditing', () => ({ audit: vi.fn() }))

describe('auditProjectChange', () => {
  afterEach(() => vi.clearAllMocks())

  test('emits the actor, project and changed auditable data type', () => {
    auditProjectChange({
      actorId: 'defra-id-user',
      projectId: 'project-id',
      operation: 'updated',
      dataType: 'baseline.feature',
      featureId: 'feature-id',
      uploadId: 'upload-id'
    })

    expect(audit).toHaveBeenCalledWith(
      {
        event: PROJECT_AUDIT_EVENT,
        outcome: 'succeeded',
        actorId: 'defra-id-user',
        projectId: 'project-id',
        operation: 'updated',
        dataType: 'baseline.feature',
        featureId: 'feature-id',
        uploadId: 'upload-id'
      },
      'Project data updated'
    )
  })

  test('omits featureId for project-level changes', () => {
    auditProjectChange({
      actorId: 'defra-id-user',
      projectId: 'project-id',
      operation: 'created',
      dataType: 'project'
    })

    expect(audit).toHaveBeenCalledWith(
      expect.not.objectContaining({
        featureId: expect.anything(),
        uploadId: expect.anything()
      }),
      'Project data created'
    )
  })
})
