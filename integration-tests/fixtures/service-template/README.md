# BNG Service template fixtures

Copies of files from bng-metric-harness's curated corpus,
`example-files/service-template/`, as rebuilt for BMD-1083's lineage rules
(harness branch `BMD-1083-rebuild-corpus`). The harness's
README there says how each file was made and what the service should do with
it; the harness rebuilds them from recipes, so take a fresh copy from there
rather than editing these.

| File                                                | Harness path          |
| :-------------------------------------------------- | :-------------------- |
| `default-site.gpkg`                                 | `valid/`              |
| `plain-site.gpkg`                                   | `valid/`              |
| `large-site-baseline.gpkg`                          | `valid/`              |
| `degrade-watercourse-advance-not-encroachment.gpkg` | `incomplete/`         |
| `degrade-watercourse-encroachment-no-advance.gpkg`  | `incomplete/`         |
| `missing-habitat-ref.gpkg`                          | `attribute-problems/` |
| `distinctiveness-out-of-scope.gpkg`                 | `attribute-problems/` |
| `degrade-advance-missing.gpkg`                      | `attribute-problems/` |
| `degrade-not-worse.gpkg`                            | `attribute-problems/` |
| `degrade-watercourse-retained-and-created.gpkg`     | `attribute-problems/` |
| `no-habitats.gpkg`                                  | `empty-layer/`        |
| `lineage-parent-missing.gpkg`                       | `lineage-problems/`   |
| `lineage-parent-unknown.gpkg`                       | `lineage-problems/`   |
| `lineage-parent-geom-mismatch.gpkg`                 | `lineage-problems/`   |
| `lineage-parent-geom-missing.gpkg`                  | `lineage-problems/`   |
| `version-record-missing.gpkg`                       | `version-problems/`   |
| `version-record-duplicated.gpkg`                    | `version-problems/`   |
| `version-unsupported.gpkg`                          | `version-problems/`   |
| `no-area-habitats-baseline-table.gpkg`              | `invalid-schema/`     |
| `wrong-geometry-type-in-area-habitats.gpkg`         | `invalid-schema/`     |
