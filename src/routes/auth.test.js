import { describe, test, expect, vi } from 'vitest'

import { postAuthSession } from './auth.js'
import { persistSession } from '../db/persist-session.js'
import { HTTP_STATUS } from '../common/helpers/http/status-codes.js'

vi.mock('../db/persist-session.js', () => ({
  persistSession: vi.fn()
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
    // persistSession also appends the login_audit row inside its transaction.
    expect(persistSession).toHaveBeenCalledWith(drizzle, credentials)
    expect(response).toHaveBeenCalledWith()
    expect(code).toHaveBeenCalledWith(HTTP_STATUS.NO_CONTENT)
    expect(result).toBe('no-content-response')
  })
})
