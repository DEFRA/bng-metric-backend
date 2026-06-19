import { describe, test, expect } from 'vitest'

import {
  ROLE_STATUS,
  ROLE_STATUS_APPROVED,
  parseRelationships,
  parseRoles,
  currentOrgContext
} from './claims.js'

const REL_A = 'rel-1'
const REL_B = 'rel-2'

// relationshipId:organisationId:organisationName:organisationLoa:relationship:relationshipLoa
const relString = (relId, orgId, orgName, rel = 'Employee') =>
  `${relId}:${orgId}:${orgName}:0:${rel}:1`

// relationshipId:roleName:status
const roleString = (relId, name, status) => `${relId}:${name}:${status}`

describe('parseRelationships', () => {
  test('parses a single relationship', () => {
    const claims = { relationships: [relString(REL_A, 'org-1', 'Acme Ltd')] }
    expect(parseRelationships(claims)).toEqual([
      {
        relationshipId: REL_A,
        orgId: 'org-1',
        orgName: 'Acme Ltd',
        relationship: 'Employee'
      }
    ])
  })

  test('parses multiple relationships', () => {
    const claims = {
      relationships: [
        relString(REL_A, 'org-1', 'Acme Ltd'),
        relString(REL_B, 'org-2', 'Globex', 'Agent')
      ]
    }
    const result = parseRelationships(claims)
    expect(result).toHaveLength(2)
    expect(result[1]).toEqual({
      relationshipId: REL_B,
      orgId: 'org-2',
      orgName: 'Globex',
      relationship: 'Agent'
    })
  })

  test('normalises a citizen (no org) to null org id/name', () => {
    // Citizens have no organisation — the token leaves those fields empty:
    // "relId:::0:Citizen:0". They must persist as null, not empty strings.
    const claims = { relationships: [`${REL_A}:::0:Citizen:0`] }
    expect(parseRelationships(claims)).toEqual([
      {
        relationshipId: REL_A,
        orgId: null,
        orgName: null,
        relationship: 'Citizen'
      }
    ])
  })

  test('reconstructs an organisation name that contains colons', () => {
    const claims = {
      relationships: [`${REL_A}:org-1:Acme: Holdings: Ltd:0:Employee:1`]
    }
    expect(parseRelationships(claims)[0]).toEqual({
      relationshipId: REL_A,
      orgId: 'org-1',
      orgName: 'Acme: Holdings: Ltd',
      relationship: 'Employee'
    })
  })

  test('accepts a bare string (not an array)', () => {
    const claims = { relationships: relString(REL_A, 'org-1', 'Acme Ltd') }
    expect(parseRelationships(claims)).toHaveLength(1)
  })

  test('drops malformed entries and returns [] when the claim is absent', () => {
    expect(parseRelationships({ relationships: ['too:few'] })).toEqual([])
    expect(parseRelationships({})).toEqual([])
    expect(parseRelationships(null)).toEqual([])
  })

  test('drops non-string entries', () => {
    expect(
      parseRelationships({ relationships: [42, relString(REL_A, 'o', 'n')] })
    ).toHaveLength(1)
  })
})

describe('parseRoles', () => {
  test('parses roles with a numeric status', () => {
    const claims = {
      roles: [
        roleString(REL_A, 'bng completer', ROLE_STATUS.COMPLETE_APPROVED),
        roleString(REL_B, 'bng viewer', ROLE_STATUS.PENDING)
      ]
    }
    expect(parseRoles(claims)).toEqual([
      { relationshipId: REL_A, name: 'bng completer', status: 3 },
      { relationshipId: REL_B, name: 'bng viewer', status: 1 }
    ])
  })

  test('reconstructs a role name containing a colon and coerces status', () => {
    const claims = { roles: [`${REL_A}:role:with:colon:3`] }
    expect(parseRoles(claims)).toEqual([
      { relationshipId: REL_A, name: 'role:with:colon', status: 3 }
    ])
  })

  test('drops malformed and non-string entries and tolerates a missing claim', () => {
    expect(parseRoles({ roles: ['bad'] })).toEqual([])
    expect(parseRoles({ roles: [42] })).toEqual([])
    expect(parseRoles({})).toEqual([])
  })

  test('drops a role whose status is a non-numeric word (never NaN)', () => {
    // The CDP Defra ID stub's registration UI emits word labels as the status
    // segment, e.g. "123:bng completer:complete". Number() of that is NaN, which
    // previously failed to bind to the smallint status column.
    const claims = {
      roles: [
        roleString('123', 'bng completer', 'complete'),
        roleString(REL_A, 'bng completer', ROLE_STATUS.COMPLETE_APPROVED)
      ]
    }
    const result = parseRoles(claims)
    expect(result).toEqual([
      { relationshipId: REL_A, name: 'bng completer', status: 3 }
    ])
    expect(result.every((role) => Number.isInteger(role.status))).toBe(true)
  })

  test('drops a role whose status is out of the 1–7 range or empty', () => {
    const claims = {
      roles: [
        roleString(REL_A, 'bng completer', '0'),
        roleString(REL_B, 'bng completer', '8'),
        roleString(REL_A, 'bng completer', '')
      ]
    }
    expect(parseRoles(claims)).toEqual([])
  })
})

describe('currentOrgContext', () => {
  test('resolves orgId from the matching relationship', () => {
    const claims = {
      currentRelationshipId: REL_B,
      relationships: [
        relString(REL_A, 'org-1', 'Acme Ltd'),
        relString(REL_B, 'org-2', 'Globex')
      ]
    }
    expect(currentOrgContext(claims)).toEqual({
      relationshipId: REL_B,
      orgId: 'org-2'
    })
  })

  test('resolves a citizen current relationship to orgId null', () => {
    const claims = {
      currentRelationshipId: REL_A,
      relationships: [`${REL_A}:::0:Citizen:0`]
    }
    expect(currentOrgContext(claims)).toEqual({
      relationshipId: REL_A,
      orgId: null
    })
  })

  test('returns orgId null when currentRelationshipId has no match', () => {
    const claims = {
      currentRelationshipId: 'rel-unknown',
      relationships: [relString(REL_A, 'org-1', 'Acme Ltd')]
    }
    expect(currentOrgContext(claims)).toEqual({
      relationshipId: 'rel-unknown',
      orgId: null
    })
  })

  test('returns nulls when currentRelationshipId is missing', () => {
    expect(currentOrgContext({ relationships: [] })).toEqual({
      relationshipId: null,
      orgId: null
    })
  })
})

describe('role status constants', () => {
  test('approved is 3 and the map is frozen', () => {
    expect(ROLE_STATUS_APPROVED).toBe(3)
    expect(ROLE_STATUS.COMPLETE_APPROVED).toBe(3)
    expect(Object.isFrozen(ROLE_STATUS)).toBe(true)
  })
})
