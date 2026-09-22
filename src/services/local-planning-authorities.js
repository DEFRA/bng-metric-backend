import Boom from '@hapi/boom'
import { eq } from 'drizzle-orm'
import { localPlanningAuthorities } from '../db/schema/index.js'

// Only resolve fields explicitly patched; unrelated edits retain the saved LPA.
export async function resolveLocalPlanningAuthority(db, patch) {
  if (!Object.hasOwn(patch, 'localPlanningAuthorityReference')) {
    if (Object.hasOwn(patch, 'localPlanningAuthority')) {
      if (patch.localPlanningAuthority) {
        throw Boom.badRequest('Select a Local Planning Authority reference')
      }
      return {
        ...patch,
        localPlanningAuthority: null,
        localPlanningAuthorityReference: null
      }
    }
    return patch
  }
  const reference = patch.localPlanningAuthorityReference
  if (reference === null) {
    return { ...patch, localPlanningAuthority: null }
  }
  const [authority] = await db
    .select()
    .from(localPlanningAuthorities)
    .where(eq(localPlanningAuthorities.reference, reference))
  if (!authority) {
    throw Boom.badRequest('Select a Local Planning Authority from the list')
  }
  return { ...patch, localPlanningAuthority: authority.name }
}
