// Pure parsers for the colon-delimited relationship/role strings carried in a
// Defra ID (Customer Identity) token, plus the role-status constants used by
// RBAC. No I/O, no logging — keep it side-effect free so it is trivially
// unit-testable and safe to call from the verified-token path.
//
// Token field shapes (per Defra Identity convention):
//   relationship: relationshipId:organisationId:organisationName:organisationLoa:relationship:relationshipLoa
//   role:         relationshipId:roleName:status
//
// Organisation names can themselves contain ':' (e.g. "Acme: Holdings Ltd"), so
// the relationship parser pins the fixed leading/trailing fields positionally
// and rebuilds the name from everything in between rather than taking parts[2].

// Defra Identity enrolment status codes (1–7). Only COMPLETE_APPROVED (3) grants
// access; every other value denies. Loss of access arrives as a status update
// to 6/7 rather than the role being removed from the token. Names beyond
// COMPLETE_APPROVED are descriptive only and carry no logic — do not branch on
// them. Extracted to satisfy Sonar S109 (no magic numbers).
const ROLE_STATUS = Object.freeze({
  PENDING: 1,
  PENDING_VERIFICATION: 2,
  COMPLETE_APPROVED: 3,
  COMPLETE_REJECTED: 4,
  PENDING_APPEAL: 5,
  REMOVED: 6,
  LOCKED: 7
})

const ROLE_STATUS_APPROVED = ROLE_STATUS.COMPLETE_APPROVED

// Valid enrolment status codes span PENDING (1) – LOCKED (7). A status outside
// that range — or a non-numeric one — is not a real Defra Identity status, so the
// role is dropped rather than coerced. The CDP Defra ID stub's interactive
// registration UI emits word labels ("complete", "pending", …) instead of codes;
// without this guard Number() turns them into NaN, which then fails to bind to the
// notNull smallint `status` column (invalid input syntax for type smallint: "NaN").
const ROLE_STATUS_MIN = ROLE_STATUS.PENDING
const ROLE_STATUS_MAX = ROLE_STATUS.LOCKED

// Fixed fields at the front (relationshipId, organisationId) and back
// (organisationLoa, relationship, relationshipLoa) of a relationship string.
const RELATIONSHIP_LEADING_FIELDS = 2
const RELATIONSHIP_TRAILING_FIELDS = 3
const RELATIONSHIP_MIN_FIELDS =
  RELATIONSHIP_LEADING_FIELDS + RELATIONSHIP_TRAILING_FIELDS + 1
// A role is relationshipId : name : status — name reconstructed from the middle.
const ROLE_MIN_FIELDS = 3

function toEntries(value) {
  if (Array.isArray(value)) {
    return value
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value]
  }
  return []
}

function parseRelationship(entry) {
  if (typeof entry !== 'string') {
    return null
  }
  const parts = entry.split(':')
  if (parts.length < RELATIONSHIP_MIN_FIELDS) {
    return null
  }
  const nameParts = parts.slice(
    RELATIONSHIP_LEADING_FIELDS,
    -RELATIONSHIP_TRAILING_FIELDS
  )
  return {
    relationshipId: parts[0],
    // Citizens have no organisation: their org id/name fields are empty in the
    // token (e.g. "relId:::0:Citizen:0"). Normalise empty to null so the DB
    // stores null (not '') and the frontend can hide the org for citizens.
    orgId: parts[1] || null,
    orgName: nameParts.join(':') || null,
    // The `relationship` descriptor (Citizen | Employee | Agent) sits
    // second-from-last (before relationshipLoa).
    relationship: parts.at(-2) || null
  }
}

// Coerce the trailing status field to a number, but only when it is a clean
// integer in the valid 1–7 range. Returns null for anything else (non-numeric,
// empty, out of range) so the role is dropped rather than persisted as NaN.
function parseStatus(raw) {
  if (!/^\d+$/.test(raw)) {
    return null
  }
  const status = Number(raw)
  if (status < ROLE_STATUS_MIN || status > ROLE_STATUS_MAX) {
    return null
  }
  return status
}

function parseRole(entry) {
  if (typeof entry !== 'string') {
    return null
  }
  const parts = entry.split(':')
  if (parts.length < ROLE_MIN_FIELDS) {
    return null
  }
  const status = parseStatus(parts.at(-1))
  if (status === null) {
    return null
  }
  return {
    relationshipId: parts[0],
    name: parts.slice(1, -1).join(':'),
    status
  }
}

/**
 * Parse the `relationships` claim into structured objects. `orgId`/`orgName` are
 * null for citizens (who have no organisation); `relationship` is one of
 * Citizen | Employee | Agent.
 * @param {object} claims verified token payload
 * @returns {Array<{relationshipId: string, orgId: string|null, orgName: string|null, relationship: string|null}>}
 */
function parseRelationships(claims) {
  return toEntries(claims?.relationships)
    .map(parseRelationship)
    .filter((rel) => rel !== null)
}

/**
 * Parse the `roles` claim into structured objects (status coerced to a number).
 * @param {object} claims verified token payload
 * @returns {Array<{relationshipId: string, name: string, status: number}>}
 */
function parseRoles(claims) {
  return toEntries(claims?.roles)
    .map(parseRole)
    .filter((role) => role !== null)
}

/**
 * Resolve the user's current org context from `currentRelationshipId`, matched
 * against the parsed relationships. Returns `orgId: null` when there is no
 * current relationship or it does not appear among the parsed relationships.
 * @param {object} claims verified token payload
 * @returns {{relationshipId: string|null, orgId: string|null}}
 */
function currentOrgContext(claims) {
  const relationshipId = claims?.currentRelationshipId ?? null
  if (!relationshipId) {
    return { relationshipId: null, orgId: null }
  }
  const match = parseRelationships(claims).find(
    (rel) => rel.relationshipId === relationshipId
  )
  return { relationshipId, orgId: match?.orgId ?? null }
}

export {
  ROLE_STATUS,
  ROLE_STATUS_APPROVED,
  parseRelationships,
  parseRoles,
  currentOrgContext
}
