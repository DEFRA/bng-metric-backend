# Geometry validation

Uploaded GeoPackages are checked against fifteen geometry rules — the redline
must be valid, inside England and under 100 km²; parcels must not overlap, must
not escape the redline, must not be under a square metre; hedgerows,
watercourses, IGGIs and trees must sit inside the boundary; the parcels must sum
to the redline.

All fifteen run **in this process**, on a worker thread, with GEOS compiled to
WebAssembly. Validation takes **no database connection at all**.

## Why it works this way

Validation used to be a single large PostGIS statement, and it rationed itself on
database connections — a resource shared with every login and page load, and one
the service cannot scale on its own. With a light pooled-query probe running
alongside, against the same `max: 10` pool the app uses:

|                                     | Probe requests served in 12 s | Connection acquire p50 |
| ----------------------------------- | ----------------------------: | ---------------------: |
| Idle                                |                       ~73,000 |                   0 ms |
| 12 concurrent no-op loops (control) |                       ~98,000 |                   0 ms |
| 12 concurrent validations, PostGIS  |                         **1** |          **18,162 ms** |
| 12 concurrent validations, GEOS     |                      ~116,000 |                   0 ms |

Read the GEOS row against the _control_, not against idle: twelve pending async
loops raise the probe rate above idle on their own, because the event loop polls
harder when it has work. The honest statement is that validation load became
**indistinguishable from no validation at all**, where before it collapsed the
service to a single served request with an eighteen-second wait for a
connection.

GEOS is also the library PostGIS calls, so this was never a reimplementation of
the geometry — it is the same geometry, reached without a round trip to something
the service cannot add more of. Reproduce any of this with
`node scripts/bench-geometry-validation.mjs <fixture-dir>` (the PostGIS arm of
the comparison was taken before that engine was deleted — see the script header).

## How the old engine's correctness was kept

The PostGIS statement is gone. Its **answers** are not.

- `integration-tests/fixtures/postgis-geometry-verdicts.json` records the verdict
  that engine gave for all 98 readable GeoPackages in the harness's
  `example-files/` — the valid ones, the deliberately broken ones, the five real
  BNG-500 submissions and the whole BMD-934 permutations catalogue.
  `geometry-verdict-regression.test.js` replays every one of them through the
  real worker pool and asserts the verdict, payload and message still match.
  Nobody designed those files to agree with anything, which is what makes them
  worth more than fixtures written alongside the code they test.
- `integration-tests/geometry-validate-baseline-layers.test.js` is the
  rule-by-rule spec. It was **written against the PostGIS engine** and its
  fixtures and thresholds are unchanged; it was simply pointed at the new engine.
  Around forty assertions covering tolerance boundaries, invalid-parcel overlaps,
  coordinate systems and the details payloads.
- `error-builders.js` — the module that turns a payload into the sentence a user
  reads — is untouched from when the SQL produced those payloads. Keeping the
  payload shape is what keeps the wording identical, and it is why `payloads.js`
  documents field names, ordering and the 50-row cap as a contract.

The one known difference is cosmetic: the two libraries can start an identical
ring at a different vertex, so a WKT string in the tail of a message may read
`POLYGON((529830 180170,…))` where PostGIS wrote `POLYGON((529870 180170,…))`.
Same triangle, same area, same verdict. The regression suite normalises ring
rotation and relaxes nothing else — digits, punctuation and vertex order all
still have to match, because `postgisWkt()` in `geos-runtime.js` reconciles the
two libraries' formatting conventions.

## The worker pool

GEOS is synchronous C code, and running it inline freezes the process. Measured
on a 5,000-parcel file by sampling how late a 10 ms interval actually fires:

|                                |  Duration | Loop lag p50 | Loop lag max | Timer ticks |
| ------------------------------ | --------: | -----------: | -----------: | ----------: |
| PostGIS (awaited query)        | 13,532 ms |       1.3 ms |       126 ms |       1,173 |
| GEOS inline on the main thread |    694 ms |       1.2 ms |   **684 ms** |       **4** |
| GEOS on a worker thread        |    756 ms |       1.0 ms |        18 ms |          70 |

Four timer ticks in 694 ms is the whole story: run inline, the loop gets almost
no turns and the process serves nothing else for the duration. Worker threads are
a precondition here, not an optimisation.

| Setting                               | Default | What it is                                                           |
| ------------------------------------- | ------: | -------------------------------------------------------------------- |
| `VALIDATION_WORKER_COUNT`             |       2 | Workers, capped at `availableParallelism() - 1`.                     |
| `VALIDATION_WORKER_QUEUE_LIMIT`       |       8 | Validations allowed to wait for a free worker. Not free — see below. |
| `VALIDATION_WORKER_TIMEOUT_MS`        |   30000 | Per-job budget; on overrun the worker is terminated.                 |
| `VALIDATION_BUSY_RETRY_AFTER_SECONDS` |      30 | `Retry-After` on the 503 sent when the queue is full.                |

The pool cap **is** the admission control. It is the same protective bounding the
connection pool used to provide, except the rationed resource is CPU on an
instance CDP can add more of.

### What happens when the pool cannot cope

There is **no fallback**. The PostGIS path does not exist to fall back to, and
that is deliberate: a fallback would mean the same file getting a different
answer depending on how busy the box was, and it would quietly push load back
onto the database the moment capacity got tight — which is the problem this
replaced.

Instead the two failure modes are told apart, because the user's next action
differs:

| Condition                   | Response                                                | Why                                                                                                     |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Queue full                  | **503** + `Retry-After`, body carries `VALIDATION_BUSY` | The file was never looked at. Nothing is wrong with it and there is nothing to fix — come back shortly. |
| Timeout, crash, worker gone | **500** `VALIDATION_FAILED`                             | Something went wrong looking at this file. Retrying will most likely do the same thing.                 |

`VALIDATION_BUSY` is deliberately **not** a validation error. The frontend picks
the 503 out in `services/baseline.js`, returns `{ busy: true }`, and the upload
controller sends the user back to the upload page with "The service is busy
checking other files. Please try again in a few moments." — the same treatment an
upload timeout already gets. It must never reach `/error-file`, which is the
"there is a problem with your file" screen.

`GeoPackageValidationBusy` counts these. A non-zero rate is a capacity signal:
the levers are `VALIDATION_WORKER_COUNT` (if the task has the memory) or more
backend instances.

The timeout is 30 s rather than something larger precisely because there is no
fallback — it has to fire while there is still a request to fail, well inside a
load-balancer timeout. The slowest validation measured, on a 5,000-parcel file on
a contended box, was under two seconds.

### Memory is why the pool is small

WebAssembly linear memory grows to the high-water mark of the work done and is
never handed back, so a worker that has validated one large file keeps that
footprint for the rest of its life. Worker threads live in the SAME process as
the server, so this counts against the same container limit — it is not budget
that sits somewhere else.

Measured on a 5,000-parcel fixture, as whole-process RSS:

|                                        |                               RSS |
| -------------------------------------- | --------------------------------: |
| Server modules loaded, no workers      |                             58 MB |
| 1 worker, after one validation         |                            233 MB |
| 2 workers, after one validation each   |                            339 MB |
| 2 workers, after five validations each | **565 MB** (flat from the fourth) |

So roughly **250 MB per worker**, plateauing rather than leaking. Two properties
follow, and both are easy to get wrong:

- **It is the LARGEST file a worker has ever seen that sets its footprint, not
  the average.** Most real submissions are tens of features and would settle far
  lower — but one 5,000-parcel upload pins that worker at ~250 MB permanently.
  Size the pool for the worst file you accept, not the typical one.
- **Recycling workers would not reclaim it.** Killing a worker and starting a
  fresh one does not return the memory to the OS; the replacement reuses the
  pages. Measured over six kill-and-restart cycles, RSS settles at ~279 MB and
  stops climbing — so the timeout and crash paths are safe, but there is no point
  building a "restart every N jobs" mechanism, because it would buy nothing.

**Check the ECS task memory limit before raising `VALIDATION_WORKER_COUNT`.** The
default of 2 wants roughly 565 MB of headroom on top of Node's own baseline and
the parsed layers in-flight uploads hold. At a 2 GB task that is comfortable; at
1 GB it is one worker at most.

### What a deep queue costs

The queue holds job objects — an id, a file path, two callbacks — so the array
itself is a couple of kilobytes at the default limit and can be ignored. What
cannot be ignored is what each _waiting request_ holds elsewhere.

A queued validation belongs to a request sitting inside
`validateGeoPackageLayers`, and that request still has the parsed GeoPackage the
format gate produced: measured at **~29 MB of heap per in-flight upload** on the
5,000-parcel fixture. Eight queued plus two in flight is therefore up to ~290 MB
on top of the workers' own ~500 MB.

Unlike the workers' WebAssembly heap this memory is **transient** — garbage once
the request ends, not a high-water mark. But **raising
`VALIDATION_WORKER_QUEUE_LIMIT` raises that ceiling directly**, and it is worth
being clear that the limit rations CPU rather than memory. If a task is tight on
memory, lowering the queue limit is a better lever than lowering the worker
count: the workers are what earn the throughput, and the queue is what quietly
eats the headroom.

### Why the worker is given a file path, not the layers

Posting parsed layers across the thread boundary would mean a structured clone of
that ~29 MB object graph per upload, and would leave the synchronous
better-sqlite3 parse on the main thread — the very thing worth moving. The worker
takes the path of the file `downloadFileToTemp` has already put on local disk and
parses it itself. That costs a second parse (57 ms at 5,000 parcels) and saves
the whole validation.

`filePath` therefore has to be threaded from the route to
`validateGeoPackageLayers`, which throws without one rather than silently
skipping the geometry checks.

## Habitat sizing comes along for free

`calculateHabitatSizes` used to send the same geometry to PostGIS a second time
to get `ST_Area` / `ST_Length` per feature — a fourth pass over shapes already
parsed, repaired and measured. The worker holds the repaired geometry at the
moment it finishes checking, so the measurements now return with the verdict and
`calculateHabitatSizes` is a pure function.

The sizes are keyed by a feature's position within its layer, because that is all
a worker can know: `featureId` is assigned on the main thread after validation.
`attachGeometrySizes` joins the two, and it must run **before** the
post-intervention Lost filter, which renumbers what is left.

If a feature that should have been measured was not, sizing throws and the upload
fails with `SIZING_FAILED`. That is deliberately fatal rather than partial:
recording some habitats with a size and others without would corrupt the project
document in a way nobody would notice until the units came out wrong.

## Coordinate systems

`SUPPORTED_SRIDS` is `{4326, 27700}`. PostGIS reprojected with `ST_Transform`;
this engine uses proj4js, with the EPSG:27700 definition written out in full in
`geos/reproject.js` and asserted in a unit test.

That assertion matters more than it looks. The accurate WGS84 → British National
Grid transformation uses the **OSTN15 grid shift**; the fallback is a
7-parameter Helmert approximation, and the two differ by up to ~2 m. Several
published EPSG:27700 definitions omit the `+towgs84` parameters altogether, and
one of those is wrong by hundreds of metres.

Measured against PostGIS across eight sites spanning England, the worst-case
disagreement was **0.00075 m** — about 130× inside the tightest tolerance in the
validator (0.1 m) and irrelevant against the 0.5 m² area tolerances. That
agreement held because neither side had the OSTN15 grid: the tested PostGIS image
has no `.tif` files in `/usr/share/proj` and `NETWORK_ENABLED=OFF`, so PROJ fell
back to the same Helmert transform proj4js uses.

> **Open question.** If production PostGIS has the OSTN15 grid installed, it was
> more accurate than this path and EPSG:4326 verdicts may shift by up to ~2 m.
> The fix would be to supply proj4js with the same grid. This is worth settling,
> though it no longer blocks anything: there is no second engine to disagree with.

The England reference polygon is pre-projected once into
`geos/england-27700.json` rather than reprojected per request, and that committed
file is PostGIS's own `ST_Transform` output — so the containment check compares
against exactly the shape the old engine used. `npm run england-27700:check`
re-derives it with proj4 and fails CI if it has drifted from
`reference/england.geojson`.

Note that none of this touches stored data: `persist-upload.js` still transforms
geometry with PostGIS when writing rows. The database remains the system of
record — it just no longer does the checking.
