# Statutory metric reference data

Lookup tables used by `bng-metric-engine` for unit calculations and habitat/condition validation. Every file is imported statically in `src/reference-constants.js`, which is the single inventory of all reference data. The engine package holds the **full set** of tables needed for unit calculations.

## Source

**Statutory Biodiversity Metric** (Natural England / Defra).

These tables mirror the reference data embedded in the published Statutory Metric calculation tool (Excel / associated guidance), not project-specific GeoPackage attributes. Habitat type strings must match the tool’s **Habitat Type** labels (e.g. `Grassland - Modified grassland`).

| Field           | Value                                                                                                                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metric version  | Statutory Biodiversity Metric 4.0                                                                                                                                                                                                                        |
| Tool / workbook | [Biodiversity Metric and SSM - GIS Data Standard, XLSZ, 75.3kB](https://publications.naturalengland.org.uk/file/5715290378469376) and [GIS Import Tool, XLSB, 5.1 MB](https://publications.naturalengland.org.uk/file/6705047204003840) dated 2023-11-28 |
| Extracted on    | 2026-02-11                                                                                                                                                                                                                                               |
| Extracted by    | Equal Experts BNG Metric Team                                                                                                                                                                                                                            |

## Files

| JSON file                                           | Constant                                       | Purpose                                                  |
| --------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| `difficulty-multiplier.json`                        | `DIFFICULTY_MULTIPLIER`                        | Habitat difficulty band → multiplier                     |
| `habitat-area-condition-scores.json`                | `CONDITION_SCORES`                             | Condition band → numeric score per habitat area type     |
| `habitat-area-difficulty.json`                      | `HABITAT_DIFFICULTY`                           | Habitat area type → creation/enhancement difficulty band |
| `habitat-area-distinctiveness-categories.json`      | `DISTINCTIVENESS_CATEGORIES`                   | Habitat area type → distinctiveness band                 |
| `habitat-area-distinctiveness-scores.json`          | `DISTINCTIVENESS_SCORES`                       | Distinctiveness band → score and suggested action        |
| `habitat-area-time-to-target-creation.json`         | `TIME_TO_TARGET_CREATION`                      | Years to target condition, habitat area (creation)       |
| `habitat-area-time-to-target-enhancement.json`      | `TIME_TO_TARGET_ENHANCEMENT`                   | Years to target condition, habitat area (enhancement)    |
| `hedgerow-condition-scores.json`                    | `HEDGEROW_CONDITION_SCORES`                    | Condition band → numeric score per hedgerow type         |
| `hedgerow-distinctiveness-categories.json`          | `HEDGEROW_DISTINCTIVENESS_CATEGORIES`          | Hedgerow type → distinctiveness band                     |
| `hedgerow-distinctiveness-scores.json`              | `HEDGEROW_DISTINCTIVENESS_SCORES`              | Distinctiveness band → score (hedgerow)                  |
| `time-to-target-multiplier.json`                    | `TIME_TO_TARGET_MULTIPLIER`                    | Time-to-target years → multiplier                        |
| `watercourse-condition-scores.json`                 | `WATERCOURSE_CONDITION_SCORES`                 | Condition band → numeric score per watercourse type      |
| `watercourse-distinctiveness-categories.json`       | `WATERCOURSE_DISTINCTIVENESS_CATEGORIES`       | Watercourse type → distinctiveness band                  |
| `watercourse-distinctiveness-scores.json`           | `WATERCOURSE_DISTINCTIVENESS_SCORES`           | Distinctiveness band → score (watercourse)               |
| `watercourse-encroachment-multiplier.json`          | `WATERCOURSE_ENCROACHMENT_MULTIPLIER`          | Watercourse encroachment band → multiplier               |
| `watercourse-riparian-encroachment-multiplier.json` | `WATERCOURSE_RIPARIAN_ENCROACHMENT_MULTIPLIER` | Riparian encroachment band → multiplier                  |

## Updating

1. Obtain the latest published Statutory Metric reference tables from Natural England.
2. Update the relevant JSON file(s) in this directory (preserve key strings exactly — they are join keys for GeoPackage data).
3. Add a static import and export in `src/reference-constants.js` if adding a new table, and add a row to the table above.
4. Update the **Metric version** / **Extracted on** rows in this README.
5. Run `npm test -- bng-metric-engine/` and any backend tests that depend on engine calculations.

## Licence

Same as the parent package — see `bng-metric-engine/package.json` (`OGL-UK-3.0`). Statutory Metric data is published by Natural England under Open Government Licence terms.
