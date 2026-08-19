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

The full design rationale lives in the workspace note
`lineage-uuid-reconciliation.md`; the short version: the human label and the
machine key are separate fields. Baseline rows carry a hidden `feature_uuid`
(auto-filled by a QGIS default at digitise time); the copy action stamps
`parent_uuid` and `parent_checksum` (a canonical geometry hash — see
`geometry-checksum.js`, byte-compatible with the template's Python) onto every
post-intervention row. Renaming refs is cosmetic; a checksum mismatch surfaces
as the `STAGED_BASELINE_DRIFTED` warning ("baseline edited after the copy");
continuing rows with no stamp at all fall back to geometric inference and are
flagged `STAGED_PARENT_INFERRED` for confirmation.

## Resolution order

Sources, in order:

1. **The stamped parent — `parent_uuid` first, `Parent Ref` as fallback.** The template writes it once when the
   post-intervention layer is copied from the baseline. QGIS carries attributes
   verbatim through a split, so every parcel later derived by splitting keeps
   the correct parent with no geometric inference. This covers the common case.
2. **Geometry**, only for rows with no stamped parent — parcels drawn fresh,
   which need no parent for their units. (They are `Created`, but for area
   habitats the converse does not hold: built-over ground is also `Created` —
   the Statutory Metric treats development as creating the new surface — and
   keeps its stamped parent. The stamp, not the category, decides.) The
   apportionment matters for area reconciliation, not for the calculation.

   **Area habitats only.** For hedgerows, watercourses, trees and vertical
   areas an unstamped `Created` row skips the geometry rule entirely and stays
   parentless (`deriveLineage`'s `inferCreatedParents: false`): a brand-new
   planting drawn inside the site would otherwise inherit a bogus parent from
   whatever baseline feature it happens to touch. Area habitats keep the
   inference for every unstamped row because the EXACT reconciliation needs
   full lineage — every square metre must be accounted against a baseline
   parcel.

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

Established by prototyping each type in QGIS, then revised when
removal-by-absence replaced removal rows. Applying one rule everywhere would
reject legitimate work.

| Type                   | Size rule              | PI within baseline | Removal is recorded by                          |
| ---------------------- | ---------------------- | ------------------ | ----------------------------------------------- |
| Area habitats          | **exact**              | yes                | a `Created` row for the new (sealed) surface    |
| Vertical area habitats | **shortfall**          | yes                | absence — a demolished wall has no successor    |
| Hedgerows              | **shortfall**          | yes                | absence — lost length is the residual           |
| **Watercourses**       | **presence**           | **no**             | absence of any child for the whole baseline row |
| Trees                  | **shortfall** (counts) | no (points)        | absence — a felled tree is an absent point      |

The three rules (`reconcile.js`, `SIZE_RULES`):

- **exact** — baseline and post-intervention totals must balance. Only area
  habitats: ground inside the red line cannot vanish, so building on it is
  recorded as `Created` developed land / sealed surface, and an absent parcel
  is indistinguishable from a mapping gap. Mismatch is an **error**.
- **shortfall** — per stamped parent, children may total _less_ than the
  parent (the difference is what was removed — a **warning**,
  `STAGED_FEATURES_REMOVED`) but never _more_ (an **error**,
  `STAGED_PARENT_OVERSUBSCRIBED`: children are contained within their parent,
  so an excess is a duplicated or mis-stamped row). This is the Statutory
  Metric's own bookkeeping: its hedgerow sheets take retained/enhanced lengths
  per baseline row and derive the lost length as the residual — it is never
  entered as a row.
- **presence** — watercourses only. Re-meandering a straightened channel moves
  it off the old line and makes it longer — a headline BNG intervention — so
  child lengths say nothing about how much baseline was lost. A parent with at
  least one stamped child continues in full; a parent with none is treated as
  removed (**warning**). Partial watercourse loss is expressed by drawing the
  baseline stretch as two features at survey time.

Removal warnings never fail the file. The template's copy action populates
post-intervention with every baseline feature, so an absent row is always a
deliberate deletion — but the surveyor is told what the calculation will
assume, because absence is also what a slip of the delete key looks like.

## Containment

For the three types whose policy says so, every post-intervention feature must
lie inside the baseline parcel it was cut from. `containment.js` enforces it.

Two things about how, both of which matter:

**It measures the size of `ST_Difference`, never a Boolean predicate.** A PI
parcel cut from its parent shares that parent's edges exactly, and a vertex one
ULP outside a shared edge makes `ST_Within` false while the geometric distance
is zero — so a predicate rejects ordinary correct work. Measuring also gives the
surveyor something actionable: "1000 sq m outside PR-1", not "not within". The
tolerances are the redline checks' own (`postgis/constants.js`), because the
situation is the same one: a feature sharing an edge with the polygon it is
being tested against.

**Only features with a _stamped_ parent are tested.** A parent derived from
geometry is derived _by_ overlap, so testing it for overlap proves nothing.
Worse, it would reject real work: the fixture's pond legitimately straddles both
baseline parcels, and against either one alone it "escapes" by 1250 sq m.

A parent named by more than one baseline row is unioned before the difference is
taken — that is one parent drawn in several pieces, and differencing against
only the first would report the rest of it as an escape.

Watercourses and trees are exempt, and the exemption is the point. Re-meandering
a straightened channel moves it off the old line; it is a headline BNG
intervention, and a containment rule would reject every instance of it.

## featureId carry-forward

Same problem and the same answer as `../carry-forward-feature-ids.js` does for
the single-stage format: without it, every re-upload mints fresh UUIDs, and a
downstream relational consumer sees a mass delete-and-reinsert instead of an
update, losing all row-level history.

The staged format has two natural keys, one per stage:

| Stage             | Key                       |
| ----------------- | ------------------------- |
| post-intervention | `PI Ref`                  |
| baseline          | `Parcel Ref` / `Tree Ref` |

`PI Ref` is sound because the template's tidy-refs action guarantees it is
unique within its layer and reproduces the same value on the same feature.
Nothing else in the file is stable across an edit-and-re-export cycle.

**The stage is part of the lookup key.** A retained parcel keeps its parent's ref
on the post-intervention side — the fixture has PI Ref `PR-1` against a baseline
Parcel Ref of `PR-1` — so a key without the stage would collapse a baseline
parcel and its post-intervention counterpart onto one id. Two features, two
rows downstream.

Matching is as conservative as the existing module: a key carries an id forward
only when it is non-blank and unambiguous on **both** sides. Uniqueness is
enforced nowhere for hedgerows, watercourses or trees, so a repeated ref is
possible and cannot say which feature owns the stored id. Anything blank,
ambiguous or unmatched gets a fresh UUID.

## Files

| File                            | Does                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `staged-layer-names.js`         | resolve table names to (stage, habitat type); unknown tables are ignored, never fatal |
| `read-staged-geopackage.js`     | read one file into `{ baseline, postIntervention, redline }` with lineage columns     |
| `derive-lineage.js`             | stamped parents first, then area-weighted geometry for the rest                       |
| `reconcile.js`                  | per-type policy and size comparison                                                   |
| `containment.js`                | PI-inside-parent, by size of `ST_Difference`, for the types whose policy demands it   |
| `staged-feature-ids.js`         | keeps `featureId` stable across re-uploads, keyed on `PI Ref` / `Parcel Ref`          |
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

| Code                            | Fires when                                                                                                                                                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGED_MISSING_BASELINE_LAYER` | continuing (Retained/Enhanced) rows have no baseline features to reconcile against — the layer is absent or empty. A layer whose rows are ALL `Created` is exempt: brand-new habitats (planted hedgerows, new trees, new watercourses, new walls) legitimately exist at post-intervention only |
| `STAGED_UNKNOWN_PARENT_REF`     | a stamped `Parent Ref` names nothing in the baseline                                                                                                                                                                                                                                           |
| `STAGED_PI_OUTSIDE_PARENT`      | a stamped feature strays outside its parent                                                                                                                                                                                                                                                    |
| `STAGED_SIZE_MISMATCH`          | totals disagree for a type whose policy says they must match                                                                                                                                                                                                                                   |

`STAGED_UNKNOWN_PARENT_REF` earns its place: without it a dangling stamp
degrades silently, because `deriveLineage` falls through to the geometry rule
and the feature picks up a plausible-looking parent it never had.

## Fixture coverage

`integration-tests/fixtures/staged-baseline-and-pi.gpkg` is a real export from
the template, exercising all five types on both sides:

| Type           | Scenario                                                                                               | Proves                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Area habitats  | pond straddling two parcels                                                                            | geometry apportionment 1250/1250; adjacency does not confer parentage                                                                          |
| Vertical areas | wall rebuilt taller, same footprint                                                                    | accounting uses footprint **length**, not the hand-entered face area                                                                           |
| Hedgerows      | split, half retained, half grubbed out; plus HR-NEW-1, a 150 m hedge planted at post-intervention only | the absent half surfaces as a 100 m removal warning on its parent; the parentless `Created` hedge passes with no warning and enriches to units |
| Watercourses   | re-meandered off the old line                                                                          | the presence rule is load-bearing — an equal-length rule would reject                                                                          |
| Trees          | one retained, one felled (absent), one planted                                                         | a felled tree warns; a point inside a parcel inherits nothing from it                                                                          |

Two negative tests earn their keep: pasting duplicate children makes the parent
oversubscribed by exactly the duplicated 100 m, and stripping the stamped
parents forces the geometry path and shows each trimmed parcel still resolving
to exactly one parent.

`staged-validation.test.js` breaks a throwaway copy of the same fixture five
ways — dangling parent ref, missing baseline layer, deleted retained hedgerow
row (a warning, not an error), deleted area parcel (still an error), and PI
parcel PR-1 shifted 10 m west. The shift is a translation, so the area is
unchanged and the totals still reconcile: containment is the only thing that
fails, which is what makes the assertion about containment rather than about
size.

## Not done

- **A staged file gets lineage checks only.** The PostGIS geometry suite in
  `../postgis/index.js` — redline containment, parcel overlaps, invalid
  geometry, the redline/parcel area sum — is not yet wired to the staged
  tables. `readStagedGeoPackage` now carries a per-feature SRID, so the shape
  blocker is gone; adapting the suite is the next piece of work and the
  largest remaining validation gap.
- **A valid staged upload with a `projectId` persists BOTH subtrees.** The
  route hands the validation result to
  `services/upload/save-staged-upload-for-project.js`, which transforms the
  staged read into the two legacy layer shapes (`staged-to-legacy.js`), builds
  and enriches both documents (baseline and post-intervention, including
  vertical area habitat units), and writes both — JSONB subtrees and geometry
  rows — in ONE transaction, with the per-parent removal report persisted as
  `removedHabitats` on the post-intervention subtree.
- **The staged tables' columns are not validated.** The gate skips the schema
  comparison for staged files because `gpkg-template.schema.json` describes the
  single-stage template. A staged template schema of its own would close this.
- Containment tests only features with a **stamped** parent. A feature whose
  parent came from geometry is unchecked — by construction there is nothing to
  check, but it does mean a `Created` parcel drawn wildly out of place is caught
  by the redline checks (which staged files do not get yet) rather than here.
- `staged-feature-ids.js` keys the baseline on the hidden `feature_uuid`
  (falling back to the visible ref for pre-uuid files) and the
  post-intervention side on `PI Ref` — a PI row has no uuid of its own, only
  its parent's. The staged save path rebuilds its `stored` argument from the
  persisted project document (`stagedStoredShapeFromProject`), so featureIds
  survive re-uploads even when a surveyor renames a baseline parcel.
- **Nothing validates the hand-entered sizes.** A vertical area habitat's `Area`
  and a tree's `Count` cannot be derived from geometry, so a wrong value passes
  every check here. Reconciliation catches a changed _footprint_, not a wrong
  face area. These need present/numeric/positive validation of their own, and
  possibly a plausibility bound (an `Area` implying an absurd wall height when
  divided by the footprint length).
