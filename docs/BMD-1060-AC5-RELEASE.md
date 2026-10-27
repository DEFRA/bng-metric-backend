# BMD-1060 AC5: existing-project recovery

The revised AC5 preserves valid advance/delay on Lost area replacements.
Retained timing remains redundant; Lost linear habitats and trees remain
excluded from the post-intervention document. No default timing is inferred
when the saved value is missing.

## Impact on projects imported under the old rule

The old rule cleared both timing fields on Lost areas and priced them with
zero advance/delay. Those saved units may therefore differ from the correct
calculation for the original file. Once a baseline edit re-derives such a row,
missing required timing correctly produces null units and Incomplete status.
Project totals and trading figures can change as a result. The parcel, raw
properties and geometry are retained.

An existing row with null saved timing is not automatically restored from raw
properties by this change. Raw values must pass the current validation rules;
replaying them without an agreed recovery process could reinstate deliberately
cleared or inconsistent data.

## Manual migration and release procedure

1. Before production rollout, confirm with the service owner whether projects
   imported under the old rule need preservation. Production usage has not been
   established by this code review. Identify affected original Lost area rows
   with both saved timing fields null, and retain their project/feature IDs and
   approved source values for verification.
2. Deploy the revised AC5 backend together with the Created-area edit support
   and matching frontend (backend PRs #540/#539 and frontend PR #418).
3. For a project that must preserve its other edits, use the Created-area
   editor to enter the intended advance/delay from its approved source. Zero is
   an explicit valid selection; both positive values are invalid. Save applies
   the same reference validation and metric calculation as other edits, keeps
   project and feature IDs, and synchronizes the geometry reference in the same
   transaction. Repair any other missing calculation inputs as necessary.
4. Alternatively, re-upload the latest correct post-intervention file. This
   replaces post-intervention data, so incorporate any manual changes that must
   be retained in that file first. New import validation retains valid Lost-area
   timing, clears conflicts and preserves genuinely missing timing as null.
5. Verify each repaired row has the intended saved timing and either calculated
   units/Complete status or null units/Incomplete status for remaining missing
   inputs. Check the refreshed project totals and trading figures with the
   project owner before treating the old results as superseded.

If real projects require bulk automated recovery, agree and review that
validation-aware migration before rollout. This PR contains the explicit
repair/re-upload procedure, not an unreviewed production-data backfill. Test-only
projects can simply be re-uploaded using the revised importer.
