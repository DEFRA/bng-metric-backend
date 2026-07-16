import { describe, test, expect, vi } from 'vitest'

import { postAuthSession, postAuthLoginAudit } from './auth.js'
import { persistSession } from '../db/persist-session.js'
import { insertLoginAudit } from '../db/persist-login-audit.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

vi.mock('../db/persist-session.js', () => ({
  persistSession: vi.fn()
}))

vi.mock('../db/persist-login-audit.js', () => ({
  insertLoginAudit: vi.fn()
}))

describe('POST /auth/session', () => {
  test('is a POST route at /auth/session guarded by defra-jwt', () => {
    expect(postAuthSession.method).toBe('POST')
    expect(postAuthSession.path).toBe('/auth/session')
    expect(postAuthSession.options.auth).toBe('defra-jwt')
  })

  test('persists the verified token claims and returns 204', async () => {
    const drizzle = { tag: 'drizzle' }
    const credentials = { sub: 'user-1', email: 'a@b.test' }
    const code = vi.fn().mockReturnValue('no-content-response')
    const response = vi.fn().mockReturnValue({ code })
    const request = { drizzle, auth: { credentials } }

    const result = await postAuthSession.handler(request, { response })

    // Identity comes from the verified token (credentials), never the payload.
    expect(persistSession).toHaveBeenCalledWith(drizzle, credentials)
    expect(response).toHaveBeenCalledWith()
    expect(code).toHaveBeenCalledWith(HTTP_STATUS.NO_CONTENT)
    expect(result).toBe('no-content-response')
  })
})

describe('POST /auth/login-audit', () => {
  test('is a POST route at /auth/login-audit guarded by defra-jwt', () => {
    expect(postAuthLoginAudit.method).toBe('POST')
    expect(postAuthLoginAudit.path).toBe('/auth/login-audit')
    expect(postAuthLoginAudit.options.auth).toBe('defra-jwt')
  })

  test('appends the login-audit row from the verified token claims and returns 204', async () => {
    const drizzle = { tag: 'drizzle' }
    const credentials = {
      sub: 'user-1',
      email: 'a@b.test',
      sessionId: 'sess-1'
    }
    const code = vi.fn().mockReturnValue('no-content-response')
    const response = vi.fn().mockReturnValue({ code })
    const request = { drizzle, auth: { credentials } }

    const result = await postAuthLoginAudit.handler(request, { response })

    // Identity comes from the verified token (credentials), never the payload.
    expect(insertLoginAudit).toHaveBeenCalledWith(drizzle, credentials)
    expect(response).toHaveBeenCalledWith()
    expect(code).toHaveBeenCalledWith(HTTP_STATUS.NO_CONTENT)
    expect(result).toBe('no-content-response')
  })
})
