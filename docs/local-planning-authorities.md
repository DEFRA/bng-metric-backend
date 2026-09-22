# Local Planning Authorities (BMD-1012)

The lookup is a static PostgreSQL copy of the Planning Data API's current English
LPAs, as agreed in the Planning Data spike. The initial snapshot was downloaded on
22 September 2026 using:

<https://www.planning.data.gov.uk/entity.json?dataset=local-planning-authority&limit=500&field=name&field=reference&period=current>

The complete response contained 308 current authorities and no next page. The
catalogue's 337 records include ended authorities, which are excluded from new
selections. Only `name` and `reference` are stored; the API's automatic `entity`
field is discarded along with any other fields. There is no geometry.

Liquibase changeSet `BMD-1012-lpa-lookup` creates and seeds `bng.local_planning_authorities` from
`changelog/data/local-planning-authorities-2026-09-22.sql` transactionally. Deploy
this migration and the backend before deploying the frontend.

`GET /reference/local-planning-authorities` returns the complete array of
`{ name, reference }` objects ordered by name. No Planning Data requests are made
at runtime, so an external outage does not affect selection or saving.

The frontend posts `localPlanningAuthorityReference`. The backend resolves the
canonical name from its own table and saves both `localPlanningAuthority` and
`localPlanningAuthorityReference` in project details and the existing audit
snapshot. Unknown references and new name-only writes are rejected. An explicit
null reference clears both fields; omitting both leaves an existing selection
unchanged. Existing free-text records remain readable and are shown on the form
with a prompt to select an authority; no speculative name matching is performed.

## Refreshing

Refresh manually when the upstream list changes. Fetch the same URL, follow
`links.next` if present, and check the number of collected records against
`count`. Reject missing names/references or duplicate references. Review the
diff and add a new transactional Liquibase migration; do not change the original
seed or its checksum. Update names and insert/remove lookup records as needed.
Saved project names and references are historical snapshots and must not be
rewritten by a lookup refresh. Scheduled refresh and spatial lookups are outside
this ticket.

Source: Office for National Statistics, licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
Contains OS data © Crown copyright and database right 2026. See the
[Planning Data dataset](https://www.planning.data.gov.uk/dataset/local-planning-authority).
