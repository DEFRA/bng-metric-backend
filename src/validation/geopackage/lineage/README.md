# Staged GeoPackage lineage — spike

Ingest for the **staged** GeoPackage produced by the BNG Service QGIS template,
which carries baseline and post-intervention as separate feature tables in one
file. The existing single-stage format — one table per habitat type with
`Baseline*` and `Proposed*` on the same row — is untouched and still works.

Wired into both upload routes. A staged file uploaded to
`POST /baseline/validate/{uploadId}` or `POST /post-intervention/validate/{uploadId}`
is detected at the format gate and routed here; a single-stage file takes
exactly the path it always did.

Proven against a real template export in `integration-tests/staged-lineage.test.js`
(the lineage modules) and `integration-tests/staged-validation.test.js` (the
wiring, including one upload through the real route).

## Why the format changed

In the NE template the three views (Baseline / Proposed / Master) are three
QGIS layers over **one** table, so there is one geometry per row and all three
write to it. Splitting a parcel to carve out a created habitat therefore
_destroys the baseline geometry_ — the original shape survives nowhere in the
file. Correctness depended on the surveyor exporting the baseline before
touching post-intervention geometry, with nothing enforcing it.

Splitting also duplicated `Parcel Ref` across both halves, which
`duplicate-ref-check.js` rejects. That was the visible symptom; the geometry
loss was the actual defect.

## How lineage is established

Two sources, in order:

1. **The stamped `Parent Ref`.** The template writes it once when the
   post-intervention layer is copied from the baseline. QGIS carries attributes
   verbatim through a split, so every parcel later derived by splitting keeps
   the correct parent with no geometric inference. This covers the common case.
2. **Geometry**, only for rows with no stamped parent — parcels drawn fresh,
   which are `Created` and need no parent for their units. The apportionment
   matters for area reconciliation, not for the calculation.

### The trap worth knowing about

Parentage must use **area-weighted intersection**, never a bare `ST_Intersects`.
Post-intervention parcels are cut from the baseline, so they share edges with
their parents' _neighbours_, and `intersects` is true for anything merely
touching. Measured against the QGIS prototype:

```
PI parcel   ST_Intersects says      real overlap
PR-1        ['PR-1', 'PR-2']        ['PR-1']
PR-2        ['PR-1', 'PR-2']        ['PR-2']
PI-POND     ['PR-1', 'PR-2']        ['PR-1', 'PR-2']
```

Every parcel appears to have two parents. A bare intersects test would
mis-attribute essentially every parcel, plausibly enough to go unnoticed.
`integration-tests/staged-lineage.test.js` asserts this explicitly.

## Reconciliation is per habitat type

Established by prototyping each type in QGIS. Applying one rule everywhere
would reject legitimate work.

| Type                   | Totals must match  | PI within baseline | Enforce       |
| ---------------------- | ------------------ | ------------------ | ------------- |
| Area habitats          | yes                | yes                | both          |
| Vertical area habitats | yes                | yes                | both          |
| Hedgerows              | yes (incl. `Lost`) | yes                | both          |
| **Watercourses**       | **no**             | **no**             | red line only |
| Trees                  | n/a (counts)       | n/a (points)       | red line only |

Watercourses are the exception that matters: re-meandering a straightened
channel moves it off the old line and makes it longer. It is a headline BNG
intervention with its own layer in the NE template, and an equal-length or
containment rule would reject every instance of it.

`Lost` rows count towards the totals. They are the record that a piece of ground
was accounted for; dropping them makes a fully developed site look like it has a
coverage gap.

## Files

| File                            | Does                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `staged-layer-names.js`         | resolve table names to (stage, habitat type); unknown tables are ignored, never fatal |
| `read-staged-geopackage.js`     | read one file into `{ baseline, postIntervention, redline }` with lineage columns     |
| `derive-lineage.js`             | stamped parents first, then area-weighted geometry for the rest                       |
| `reconcile.js`                  | per-type policy and size comparison                                                   |
| `validate-staged-geopackage.js` | the entry point the routes call — runs the above and returns `{ valid, errors }`      |
| `error-builders.js`             | the four `STAGED_*` errors, shaped like the geometry ones                             |

`postgis/constants.js` was extracted from `postgis/index.js` so the lineage
overlay uses the same grid size and tolerances as the validation overlay — two
overlays on different grid sizes disagree at the sliver boundary.

## How a staged file reaches this code

`validateGpkg` (the format gate in `../geopackage.js`) opens the file, sees a
post-intervention table in `gpkg_contents`, and returns `staged: true`. The
route reads that flag and calls `validateStagedGeoPackage` instead of
`readGeoPackage` + `validateGeoPackageLayers`.

The gate has to branch there because it judges every file against
`gpkg-template.schema.json`, which describes the single-stage template. A
perfectly good staged file scored against it collects a `GPKG_MISSING_LAYER`
for `Habitats` plus one `GPKG_UNEXPECTED_FEATURE_LAYER` per staged table. So the
staged branch skips the schema comparison and checks only the Red Line Boundary,
which is identical in both formats.

`staged` is present only when true, so the gate's result for a single-stage file
is unchanged.

### Errors

| Code                            | Fires when                                                     |
| ------------------------------- | -------------------------------------------------------------- |
| `STAGED_MISSING_BASELINE_LAYER` | a post-intervention layer has no baseline counterpart          |
| `STAGED_UNKNOWN_PARENT_REF`     | a stamped `Parent Ref` names nothing in the baseline           |
| `STAGED_PI_OUTSIDE_PARENT`      | a stamped feature strays outside its parent (not yet enforced) |
| `STAGED_SIZE_MISMATCH`          | totals disagree for a type whose policy says they must match   |

`STAGED_UNKNOWN_PARENT_REF` earns its place: without it a dangling stamp
degrades silently, because `deriveLineage` falls through to the geometry rule
and the feature picks up a plausible-looking parent it never had.

## Fixture coverage

`integration-tests/fixtures/staged-baseline-and-pi.gpkg` is a real export from
the template, exercising all five types on both sides:

| Type           | Scenario                            | Proves                                                                |
| -------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Area habitats  | pond straddling two parcels         | geometry apportionment 1250/1250; adjacency does not confer parentage |
| Vertical areas | wall rebuilt taller, same footprint | reconciles on footprint **length**, not the hand-entered face area    |
| Hedgerows      | split, half retained half `Lost`    | one parent for both halves; `Lost` keeps the totals balanced          |
| Watercourses   | re-meandered off the old line       | the exemption is load-bearing — an equal-length rule would reject it  |
| Trees          | retained, removed, newly planted    | a point inside a parcel inherits nothing from it                      |

Two negative tests earn their keep: dropping the `Lost` hedgerow row makes
reconciliation fail by exactly the removed 100 m, and stripping the stamped
parents forces the geometry path and shows each trimmed parcel still resolving
to exactly one parent.

## Not done

- **A staged file gets lineage checks only.** The PostGIS geometry suite in
  `../postgis/index.js` — redline containment, parcel overlaps, invalid
  geometry, the redline/parcel area sum — reads `readGeoPackage`'s feature
  shape, including a native SRID per feature that `readStagedGeoPackage` does
  not carry. Adapting the staged read into that shape is the next piece of work
  and is the largest remaining gap.
- **Nothing persists.** A staged upload validates and returns; it is not saved
  against a project even when a `projectId` is supplied (the route logs a
  warning saying so). The stored document keeps one baseline subtree and one
  post-intervention subtree, each written by its own upload, and deciding how a
  single file writes both is a schema question rather than a validation one.
- **The staged tables' columns are not validated.** The gate skips the schema
  comparison for staged files because `gpkg-template.schema.json` describes the
  single-stage template. A staged template schema of its own would close this.
- Containment is decided by `requiresContainment()` but not yet enforced, so
  `STAGED_PI_OUTSIDE_PARENT` is defined but never emitted.
- No `featureId` carry-forward for the staged format — `PI Ref` is the natural
  key, and the template's tidy-refs action keeps it unique and stable.
- **Nothing validates the hand-entered sizes.** A vertical area habitat's `Area`
  and a tree's `Count` cannot be derived from geometry, so a wrong value passes
  every check here. Reconciliation catches a changed _footprint_, not a wrong
  face area. These need present/numeric/positive validation of their own, and
  possibly a plausibility bound (an `Area` implying an absurd wall height when
  divided by the footprint length).
