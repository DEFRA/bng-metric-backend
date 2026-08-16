# Staged GeoPackage lineage — spike

Ingest for the **staged** GeoPackage produced by the BNG Service QGIS template,
which carries baseline and post-intervention as separate feature tables in one
file. The existing single-stage format — one table per habitat type with
`Baseline*` and `Proposed*` on the same row — is untouched and still works.

Nothing here is wired into the upload routes yet. It is proven end to end
against a real template export in `integration-tests/staged-lineage.test.js`.

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

| File                        | Does                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------- |
| `staged-layer-names.js`     | resolve table names to (stage, habitat type); unknown tables are ignored, never fatal |
| `read-staged-geopackage.js` | read one file into `{ baseline, postIntervention, redline }` with lineage columns     |
| `derive-lineage.js`         | stamped parents first, then area-weighted geometry for the rest                       |
| `reconcile.js`              | per-type policy and size comparison                                                   |

`postgis/constants.js` was extracted from `postgis/index.js` so the lineage
overlay uses the same grid size and tolerances as the validation overlay — two
overlays on different grid sizes disagree at the sliver boundary.

## Not done

- Not wired into the upload routes; `readGeoPackage` still handles ingest.
- Containment is decided by `requiresContainment()` but not yet enforced.
- No `featureId` carry-forward for the staged format — `PI Ref` is the natural
  key, and the template's tidy-refs action keeps it unique and stable.
- Trees, vertical areas and hedgerows have policies and name resolution but no
  fixture coverage yet; only areas and watercourses are exercised end to end.
