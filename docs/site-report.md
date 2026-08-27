# The site report PDF

`GET /projects/{projectId}/report.pdf` renders a printable, screen-reader-structured
report for one project: the site drawn on a map with its habitat parcels over it, the
key figures, and one row per parcel carrying a thumbnail and the recorded attributes.

Delivered by BMD-984, from the spike on `spike/bmd-984-pdf-exports` in the harness.

## Where the numbers and the shapes come from

Two sources, deliberately:

|                                                           | Source                              | Why                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sizes, habitat types, conditions, unit totals             | the project JSONB document          | These are what the service shows on screen and what the unit calculation ran on. Recomputing them from the geometry would give the report a second opinion, and a report that disagrees with the page it was generated from is worse than no report. |
| Parcel, hedgerow, watercourse, tree and red-line geometry | the `bng.*_features` PostGIS tables | These are the copy the user has since **edited** through `PUT /projects/{id}/features/{featureId}`. The uploaded GeoPackage can be stale.                                                                                                            |

They are matched by `featureId`, which is the geometry row's own primary key (see
`geometryRowValues` in `src/services/upload/persist-upload.js`). A feature present in
one and not the other is dropped rather than guessed at.

The red line's **area** is the one number that comes from PostGIS rather than the
document (`ST_Area`), because the red line is a boundary, not a habitat, and carries no
`sizeSquareMetres`.

## Layout

| Path                                       | Role                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `src/routes/report.js`                     | the route: visibility check, then the PDF bytes with a `content-disposition` |
| `src/services/report/build-site-report.js` | read → fetch tiles → draw, in that order                                     |
| `src/services/report/site-data.js`         | joins the document to the geometry                                           |
| `src/db/project-geometry.js`               | `ST_AsGeoJSON` reads, one layer at a time                                    |
| `src/services/report/pdf/projector.js`     | ground metres → page points. The piece worth reading first                   |
| `src/services/report/pdf/grid.js`          | tile matrix maths; WMTS capabilities parsing                                 |
| `src/services/report/pdf/map.js`           | tile and geometry drawing                                                    |
| `src/services/report/pdf/document.js`      | the tagged document: structure tree, tables, figures                         |
| `src/services/os-tiles/`                   | the OS tiles service — the only code that knows the API key                  |
| `src/plugins/os-tiles.js`                  | the `/os-tiles` routes over that service                                     |

## Four rules the code depends on

**1. Nothing is positioned except by `projector.toPage`.** Basemap tiles included. A map
tile is not an arbitrary picture — it covers an exact, known rectangle of ground — so a
tile corner and a habitat vertex are the same kind of thing: an EPSG:27700 coordinate.
Both go through the same call, which is why there is no nudge factor anywhere.
`registration.test.js` is the proof.

**2. All tile I/O completes before any drawing starts.** pdfkit's drawing is sequential
and stateful: the cursor, the current page and the open marked-content sequence all
depend on call order. An `await` in the middle lets other work interleave and silently
corrupts both the layout and the tagged reading order. The spike's first attempt
rendered completely blank rows for exactly this reason.

**3. A marked-content sequence is opened BEFORE anything is drawn into it.** Drawing
first and marking afterwards yields a `Figure` wrapping an empty sequence, with every
drawing operation left untagged — PDF/UA 7.1-3. It renders identically and reports alt
text throughout; only a conformance checker can see it.

**4. The OS tile grid is never hard-coded.** It comes from OS's own
`GetCapabilities`. A hard-coded origin one tile out produces a basemap that looks
plausible and is in the wrong place.

## Accessibility

The document targets **PDF/UA-1** and is verified with veraPDF, the reference
open-source validator, which runs from the `verapdf/cli` image (no JDK needed):

```bash
docker run --rm -v "$PWD:/data" verapdf/cli --format text --flavour ua1 /data/report.pdf
```

It tags `Document/Sect/H1/H2/P/Table/TR/TH/TD/Figure`, sets `/Alt` on every figure,
`/Scope` (and `/Headers`) on table cells, `Lang` `en-GB` and a document title, and
embeds its font programs — Noto Sans (SIL OFL 1.1), because pdfkit's default base-14
fonts are referenced by name and never embedded, which alone fails PDF/UA.

**Two things still outstanding:**

- **A screen-reader pass (NVDA) and PAC.** A veraPDF PASS is necessary, not sufficient:
  it confirms alt text _exists_, not that it reads well — it was perfectly happy with
  "1 watercourses", which a unit test now prevents. Roughly a third of PDF/UA's failure
  conditions are human judgement. **This is the go/no-go.**
- **GDS Transport instead of Noto Sans.** GOV.UK sets GDS Transport in the browser and
  that is what this should eventually embed. It is licensed for GOV.UK services but is
  not redistributable here, so swapping it in is a licensing step, not a code change:
  replace the two files in `src/services/report/assets/fonts` and the names in
  `document.js`.

## The basemap is off

`REPORT_BASEMAP` defaults to **false**, and the `/os-tiles` routes are not registered at
all unless `OS_API_KEY` is set. That is a licensing position, not a technical one:

- **Nobody has asked OS whether we may EMBED their mapping in a downloadable PDF.** That
  is a different question from displaying it in a browser, because a PDF can be
  forwarded. It has to be asked directly.
- **Attribution wording** has to be burned into the page — a PDF cannot carry a dynamic
  credit control — and the required wording is OS's to dictate.
  `OS_MAPS_ATTRIBUTION` holds a provisional string.

The renderer is basemap-ready and tested with one. Without it, parcels are drawn on a
plain ground, which needs no permission from anybody.

### If the basemap is switched on

| Variable           | Meaning                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `OS_API_KEY`       | OS Data Hub key with the **OS Maps API** product added. A CDP secret per environment, not `cdp-app-config`. Absent → no `/os-tiles` routes. |
| `REPORT_BASEMAP`   | Draw the basemap in the report. No effect without a key.                                                                                    |
| `OS_MAPS_LAYER`    | One of the EPSG:27700 raster styles. Default `Light_27700`.                                                                                 |
| `OS_MAPS_MAX_ZOOM` | The **plan** ceiling — see below. Empty for Premium/PSGA.                                                                                   |

**The plan caps resolution, and no amount of engineering changes it.** An OpenData-plan
key serves EPSG:27700 up to z9 (1.75 m/px) and returns `403 "A Premium Plan is required
to access Premium Data"` from z10 up, while `GetCapabilities` keeps succeeding — so the
failure presents as a tile problem rather than a licensing one. Premium/PSGA reaches z13
(0.109 m/px). Defra is a PSGA member, so the likely answer is an existing departmental
project rather than a new key.

`OS_MAPS_MAX_ZOOM` deliberately does **not** default to 9: defaulting to the free
ceiling would silently discard resolution a Premium key has paid for. `pickZoom` clamps
to whatever `/os-tiles/capabilities` publishes, so nothing that draws a map has to know
anything about OS plans — the same reasoning that keeps the key out of it.

Switching to EPSG:3857 does not escape the ceiling (~1.5 m/px at GB latitudes) and costs
exact registration, so it is not an option.

### Caching

The tile cache is process-local (`src/services/os-tiles/cache.js`). This service has no
Redis — the frontend has `ioredis` and `catbox-redis`, this side has neither — and
per-instance caching already collapses the repeats _within_ one report, which is where
the bulk of the duplication is (neighbouring parcels overlap). If cross-instance reuse
turns out to matter, `get`/`set` is the seam a Redis implementation drops into, and
NRF's `nrf-frontend/src/server/common/services/tile-cache.js` is the shape to copy.

## Cost

Measured on a 50-parcel site read from real PostGIS, with no basemap: **184 kB, ~190 ms**.
Compute is not the constraint, so generating a report while the user waits is realistic.
With a basemap the cost becomes _network_ — roughly 30 tile fetches per site map, more
with parcel thumbnails — which is what to measure before ruling out a synchronous
response.

If report sizes ever grow past a few megabytes, streaming rather than buffering is the
change to make (`toBuffer` in `build-site-report.js`); buffering buys a definite
`content-length`, which is what lets a browser show download progress.
