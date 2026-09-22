import { describe, expect, it, vi } from 'vitest'
import { resolveLocalPlanningAuthority } from './local-planning-authorities.js'

const reference = 'E60000325'
const name = 'South Downs National Park LPA'

function database(rows) {
  return {
    select: vi.fn(() => ({ from: () => ({ where: async () => rows }) }))
  }
}

describe('resolveLocalPlanningAuthority', () => {
  it('uses the reference to save a canonical name, ignoring a forged name', async () => {
    expect(
      await resolveLocalPlanningAuthority(database([{ reference, name }]), {
        localPlanningAuthorityReference: reference,
        localPlanningAuthority: 'Forged',
        applicant: 'Example'
      })
    ).toEqual({
      localPlanningAuthorityReference: reference,
      localPlanningAuthority: name,
      applicant: 'Example'
    })
  })

  it('rejects an unknown reference', async () => {
    await expect(
      resolveLocalPlanningAuthority(database([]), {
        localPlanningAuthorityReference: 'E60099999'
      })
    ).rejects.toMatchObject({ output: { statusCode: 400 } })
  })

  it('rejects a new free-text name without a reference', async () => {
    await expect(
      resolveLocalPlanningAuthority(database([]), {
        localPlanningAuthority: 'Anywhere'
      })
    ).rejects.toMatchObject({ output: { statusCode: 400 } })
  })

  it.each([
    {
      localPlanningAuthorityReference: null,
      localPlanningAuthority: 'Old name'
    },
    { localPlanningAuthority: null },
    { localPlanningAuthority: '' }
  ])('clears both fields together for %j', async (patch) => {
    expect(await resolveLocalPlanningAuthority(database([]), patch)).toEqual({
      localPlanningAuthorityReference: null,
      localPlanningAuthority: null
    })
  })

  it('leaves the LPA untouched on unrelated partial edits', async () => {
    const db = database([])
    expect(
      await resolveLocalPlanningAuthority(db, { applicant: 'Example' })
    ).toEqual({ applicant: 'Example' })
    expect(db.select).not.toHaveBeenCalled()
  })
})
