# BMD-1060 AC5: existing-project recovery

The revised AC5 preserves valid advance/delay on Lost area replacements.
Retained timing remains redundant; Lost linear habitats and trees remain
excluded from the post-intervention document. No default timing is inferred
when a required saved value is missing.

## Previously imported test data

On 27 October 2026 the requester confirmed that projects affected by the old
AC5 rule are test data only and that re-uploading is acceptable. No production
backfill or automatic replay of raw timing values is required for this release.

The old rule cleared both timing fields on Lost areas and priced them with
zero advance/delay. Re-deriving one of those saved rows now correctly produces
null units and Incomplete status when required timing is missing. Totals and
trading figures can therefore change until the test data is re-uploaded.

## Recovery procedure

1. Deploy the revised AC5 backend and the Created-area edit support with its
   matching frontend (backend PRs #540/#539 and frontend PR #418). Merge the
   metric harness update (#195) first so backend comparison checks use the
   corrected AC5 expectations.
2. Re-upload the correct post-intervention file for affected test projects.
   Re-upload replaces post-intervention data; incorporate any manual changes
   that should be retained into the file first.
3. Check that valid Lost-area timing is retained, conflicting timing is nulled,
   and genuinely missing timing remains null. Verify Complete rows have the
   expected calculated units and rows missing required inputs have null units
   and Incomplete status. Check refreshed totals and trading figures.

No existing timing is inferred from zero or restored from raw properties
without validation. If preserved production projects are later identified,
review a separate recovery plan before changing their data.
