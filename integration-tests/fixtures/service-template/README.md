# BNG Service template fixtures

Copies of files from bng-metric-harness's curated corpus,
`example-files/service-template/`, at harness commit `624d976`. The harness's
README there says how each file was made and what the service should do with
it; the harness rebuilds them from recipes, so take a fresh copy from there
rather than editing these.

| File                                        | Harness path          |
| :------------------------------------------ | :-------------------- |
| `plain-site.gpkg`                           | `valid/`              |
| `large-site-baseline.gpkg`                  | `valid/`              |
| `missing-habitat-ref.gpkg`                  | `attribute-problems/` |
| `distinctiveness-out-of-scope.gpkg`         | `attribute-problems/` |
| `no-habitats.gpkg`                          | `empty-layer/`        |
| `version-record-missing.gpkg`               | `version-problems/`   |
| `version-record-duplicated.gpkg`            | `version-problems/`   |
| `version-unsupported.gpkg`                  | `version-problems/`   |
| `no-area-habitats-baseline-table.gpkg`      | `invalid-schema/`     |
| `wrong-geometry-type-in-area-habitats.gpkg` | `invalid-schema/`     |
