# Geometry validation engines

Uploaded GeoPackages are checked against fifteen geometry rules — the redline
must be valid, inside England and under 100 km²; parcels must not overlap, must
not escape the redline, must not be under a square metre; hedgerows,
watercourses, IGGIs and trees must sit inside the boundary; the parcels must sum
to the redline. There are two engines that can run those rules, and they are
required to give the same answer.

|                                 | `postgis`                                                  | `geos`                          |
| ------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| Where the geometry work happens | one large SQL statement                                    | a worker thread in this process |
| Database connections held       | 1, for the whole validation                                | 0                               |
| Library doing the geometry      | GEOS, inside PostGIS                                       | GEOS, compiled to WebAssembly   |
| Event loop                      | mostly free (the query is awaited, but marshalling is not) | free (the work is on a worker)  |
| Scales with                     | database capacity                                          | backend instances               |

`VALIDATION_ENGINE` selects between them, and it takes a third value:

| Value     | Behaviour                                                                          |
| --------- | ---------------------------------------------------------------------------------- |
| `postgis` | The SQL statement. **The default.**                                                |
| `geos`    | In-process GEOS-WASM on a worker thread, falling back to `postgis` on any failure. |
| `shadow`  | Runs both, returns the `postgis` answer, reports any difference.                   |

It is an environment variable rather than a build-time choice, so reverting to
PostGIS is a restart rather than a deploy.

## Why a second engine exists

Geometry validation was rationing itself on database connections — a resource
shared with every login and page load, and one the service cannot scale on its
own. With a light pooled-query probe running alongside, against the same
`max: 10` pool the app uses:

|                                     | Probe requests served in 12 s | Connection acquire p50 |
| ----------------------------------- | ----------------------------: | ---------------------: |
| Idle                                |                       ~73,000 |                   0 ms |
| 12 concurrent no-op loops (control) |                       ~98,000 |                   0 ms |
| 12 concurrent validations, PostGIS  |                         **1** |          **18,162 ms** |
| 12 concurrent validations, GEOS     |                      ~116,000 |                   0 ms |

Read the GEOS row against the _control_, not against idle. Merely having twelve
async loops pending raises the probe rate above idle — an artefact of the event
loop polling harder when it has work to do — so the honest statement is that GEOS
load is **indistinguishable from no validation at all**, while PostGIS load is a
collapse to a single served request with an eighteen-second wait for a
connection. All ten pool connections are held by validations; nothing else gets
one.

The spike measured the same shape on larger hardware: 60,574 idle, 5 under
PostGIS load, 71,651 under GEOS load (`evidence/geos-wasm-spike.txt`).

The in-process engine is also faster in absolute terms. Measured on the same
fixtures, GEOS run inline so the comparison is engine against engine:

| Parcels | Features |   PostGIS |   GEOS | Verdicts  |
| ------: | -------: | --------: | -----: | --------- |
|     250 |      475 |    715 ms |  38 ms | identical |
|   1,000 |    1,900 |  2,585 ms | 141 ms | identical |
|   5,000 |    9,500 | 13,483 ms | 683 ms | identical |

**Do not quote that ratio as a production expectation.** These come off a 2-vCPU
box with PostgreSQL co-resident, which starves the SQL side of CPU far more than
a real deployment would; the spike measured 1,129 ms against 575 ms at 5,000
parcels on larger hardware, and roughly 2× is the figure to plan with. What the
table is genuinely good for is its last column: the engines still agree exactly
at 5,000 parcels, an order of magnitude past anything in `example-files/`.

But the throughput table is why this was built. Validation stops competing with
everything else the service does.

## How parity is guaranteed rather than hoped for

Three structural choices, none of them tests:

1. **The error builders are shared.** `postgis/error-builders.js` turns a payload
   into the sentence a user reads, and the GEOS engine calls the same module. If
   the payloads match, the messages match by construction — there is no second
   copy of the wording to keep in step.
2. **The tolerances are shared.** Every threshold lives in
   `geometry-constants.js`; the SQL interpolates those values into the statement
   and the GEOS checks import them. Neither engine can be tuned without the other
   following.
3. **The England polygon is PostGIS's own output.** `geos/england-27700.json` was
   produced by `ST_Transform`, not re-derived, so the containment check compares
   against exactly the same shape. `npm run england-27700:check` re-derives it
   with proj4 and fails CI if it has drifted from `reference/england.geojson`.

On top of that, `integration-tests/validation-engine-parity.test.js` runs both
engines over two dozen hand-built edge cases _and_ every GeoPackage in the
harness's `example-files/` — a hundred files nobody designed to agree — asserting
identical verdicts, payloads and messages.

## The one known difference

The two libraries can render the same shape with a different starting vertex:
`POLYGON((529830 180170,529870 180170,529870 180130,529830 180170))` against
`POLYGON((529870 180170,529870 180130,529830 180170,529870 180170))`. Same
triangle, same area, same verdict, different text in the tail of an error
message. The parity suite normalises ring rotation; shadow mode classifies it as
`kind=wkt` and keeps it apart from a real disagreement.

Everything else about the WKT does match, digit for digit — GEOS with trimming
and default precision prints the same shortest-round-trip numbers `ST_AsText`
does, and `postgisWkt()` in `geos-runtime.js` reconciles the two libraries'
punctuation conventions.

## The worker pool

GEOS is synchronous C code, and running it inline freezes the process. Measured
on the 5,000-parcel file, by sampling how late a 10 ms interval actually fires:

|                                |  Duration | Loop lag p50 | Loop lag max | Timer ticks |
| ------------------------------ | --------: | -----------: | -----------: | ----------: |
| PostGIS (awaited query)        | 13,532 ms |       1.3 ms |       126 ms |       1,173 |
| GEOS inline on the main thread |    694 ms |       1.2 ms |   **684 ms** |       **4** |
| GEOS on a worker thread        |    756 ms |       1.0 ms |        18 ms |          70 |

Four timer ticks in 694 ms is the whole story: run inline, the loop gets almost
no turns at all and the process serves nothing else for the duration. On a worker
it ticks 70 times and the longest stall is 18 ms. Worker threads are a
precondition here, not an optimisation.

Note that the PostGIS row is not lag-free either — 126 ms, from synchronously
marshalling 9,500 geometries into query parameters and parsing the result back.
That work stays on the main thread whichever engine runs.

| Setting                         | Default | What it is                                       |
| ------------------------------- | ------: | ------------------------------------------------ |
| `VALIDATION_WORKER_COUNT`       |       2 | Workers, capped at `availableParallelism() - 1`. |
| `VALIDATION_WORKER_QUEUE_LIMIT` |       8 | Validations allowed to wait for a free worker.   |
| `VALIDATION_WORKER_TIMEOUT_MS`  |   60000 | Per-job budget; on overrun the worker is killed. |

The pool cap **is** the admission control. It is the same protective bounding the
connection pool used to provide, except the rationed resource is CPU on an
instance CDP can add more of.

### Memory is why the pool is small

WebAssembly linear memory grows to the high-water mark of the work done and is
never handed back, so a worker that has validated one large file keeps that
footprint for the rest of its life. Worker threads live in the SAME process as
the server, so this counts against the same container limit — it is not budget
that sits somewhere else.

Measured on the 5,000-parcel fixture (9,500 features), as whole-process RSS:

|                                        |                               RSS |
| -------------------------------------- | --------------------------------: |
| Server modules loaded, no workers      |                             58 MB |
| 1 worker, after one validation         |                            233 MB |
| 2 workers, after one validation each   |                            339 MB |
| 2 workers, after five validations each | **565 MB** (flat from the fourth) |

So roughly **250 MB per worker**, and it plateaus rather than leaking — flat
across the last two rounds, and the spike saw the same thing out to a hundred
runs.

Two properties follow, and they are easy to get wrong:

- **It is the LARGEST file a worker has ever seen that sets its footprint, not
  the average.** Most real submissions are tens of features and would settle far
  lower — but one 5,000-parcel upload pins that worker at ~250 MB permanently.
  Size the pool for the worst file you accept, not the typical one.
- **Recycling workers would not reclaim it.** Killing a worker and starting a
  fresh one does not return the memory to the OS; the replacement reuses the
  pages instead. Measured over six kill-and-restart cycles, RSS settles at
  ~279 MB and stops climbing, so the timeout / crash path is safe — but there is
  no point building a "restart every N jobs" mechanism, because it would buy
  nothing.

**Check the ECS task memory limit before raising `VALIDATION_WORKER_COUNT`, and
before shipping at all.** The default of 2 workers wants roughly 565 MB of
headroom on top of Node's own baseline and the parsed layers an in-flight upload
holds on the heap. At a 2 GB task that is comfortable; at 1 GB it is one worker
at most; below that this does not ship in the shape it is built.

### Why the worker is given a file path, not the layers

Posting the parsed layers across the thread boundary would mean a structured
clone of a ~17 MB object graph per upload, and would leave the synchronous
better-sqlite3 parse on the main thread — the very thing worth moving. The worker
takes the path of the file `downloadFileToTemp` has already put on local disk and
parses it itself. That costs a second parse (57 ms at 5,000 parcels) and saves
the whole validation.

`filePath` therefore has to be threaded from the route to
`validateGeoPackageLayers`. Without it the GEOS engine cannot run, and falls back
to PostGIS with `reason=no_file_path`.

### Every failure falls back

A full queue, an overrunning worker, a crashed thread, a missing file path — all
of them fall back to the PostGIS statement and emit
`GeoPackageValidationEngineFallback` with a `reason`. A bad day for the pool is a
slower upload, never a failed one.

## Habitat sizing comes along for free

`calculateHabitatSizes` used to send the same geometry to PostGIS a second time
to get `ST_Area` / `ST_Length` per feature — a fourth parse of shapes already
parsed, repaired and measured. When the GEOS engine produces the verdict it
returns those measurements with it, and the sizing pass becomes a pure function.

The sizes are keyed by a feature's position within its layer, because that is all
a worker knows: `featureId` is assigned on the main thread after validation.
`attachGeometrySizes` joins the two, and it must run **before** the
post-intervention Lost filter, which renumbers what is left.

If any sized feature is missing a measurement the whole result is discarded and
the PostGIS query runs — a partial result would silently record some habitats
with a size and others without.

## Coordinate systems

`SUPPORTED_SRIDS` is `{4326, 27700}`. PostGIS reprojects with `ST_Transform`;
the GEOS engine uses proj4js, with the EPSG:27700 definition written out in full
in `geos/reproject.js` and asserted in a unit test.

That assertion matters more than it looks. The accurate WGS84 → British National
Grid transformation uses the **OSTN15 grid shift**; the fallback is a
7-parameter Helmert approximation, and the two differ by up to ~2 m. Several
published EPSG:27700 definitions omit the `+towgs84` parameters altogether, and
one of those is wrong by hundreds of metres.

Measured against PostGIS across eight sites spanning England, the worst-case
disagreement is **0.00075 m** — about 130× inside the tightest tolerance in the
validator (0.1 m) and irrelevant against the 0.5 m² area tolerances. That
agreement holds because neither side has the OSTN15 grid: the tested PostGIS
image has no `.tif` files in `/usr/share/proj` and `NETWORK_ENABLED=OFF`, so
PROJ falls back to the same Helmert transform proj4js uses.

> **Open question for production.** If production PostGIS _does_ have the OSTN15
> grid installed, it is currently more accurate than this path and 4326 verdicts
> would shift by up to ~2 m. The fix would be to supply proj4js with the same
> grid, not to abandon the approach. One command settles it:
> `SELECT * FROM pg_catalog.pg_proc WHERE proname = 'postgis_proj_version';` and a
> look for `.tif` files in the image's `/usr/share/proj`.

Note that none of this touches stored data. `persist-upload.js` transforms
geometry with PostGIS when writing rows and that has not changed. Habitat sizes
are the one number that now comes from the JS transform for 4326 files.

## Rolling it out

1. `VALIDATION_ENGINE=shadow` in dev and test. Soak for **two weeks minimum**,
   watching `GeoPackageValidationEngineDivergence`. `kind=codes` must be zero.
2. Measure a real ECS task with two workers under sustained upload load, watching
   RSS plateau, before going further.
3. `VALIDATION_ENGINE=geos`, one environment at a time, watching
   `UploadPostgisValidateMs`, `UploadTotalMs` and
   `GeoPackageValidationEngineFallback`.
4. `VALIDATION_ENGINE=postgis` is the instant rollback and needs no deploy.

The PostGIS engine is retained, not deleted: it is the fallback for every worker
failure, and the answer of record until the OSTN15 question above is settled.
