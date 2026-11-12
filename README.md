# bng-metric-backend

Core delivery platform Node.js Backend Template.

- [Requirements](#requirements)
  - [Node.js](#nodejs)
- [Local development](#local-development)
  - [Setup](#setup)
  - [Development](#development)
  - [Testing](#testing)
  - [Production](#production)
  - [Npm scripts](#npm-scripts)
  - [Update dependencies](#update-dependencies)
  - [Formatting](#formatting)
    - [Windows prettier issue](#windows-prettier-issue)
- [API endpoints](#api-endpoints)
- [Development helpers](#development-helpers)
  - [Proxy](#proxy)
- [Docker](#docker)
  - [Development image](#development-image)
  - [Production image](#production-image)
  - [Docker Compose](#docker-compose)
  - [Dependabot](#dependabot)
  - [SonarCloud](#sonarcloud)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Requirements

### Node.js

Please install [Node.js](http://nodejs.org/) `>= v22` and [npm](https://nodejs.org/) `>= v11`. You will find it
easier to use the Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
cd bng-metric-backend
nvm use
```

## Local development

### Setup

Install application dependencies:

```bash
npm install
```

### Development

To run the application in `development` mode run:

```bash
npm run dev
```

### Testing

To test the application run:

```bash
npm run test
```

For integration tests that exercise the real Hapi server against a running Postgres (boot via `docker compose up -d` first), see [`docs/integration-tests.md`](docs/integration-tests.md):

```bash
npm run test:integration
```

#### Metric comparison

The _Metric comparison_ workflow (`.github/workflows/metric-comparison.yml`)
checks the service's figures against the Statutory Biodiversity Metric
spreadsheet's own, for every scenario in bng-metric-harness's corpus, on each
pull request, each merge group in the merge queue and each push to `main`. It
calls the harness's workflow with the commit to test; the job summary names
what was compared and leads with any difference nothing known explains, and the
full report is in the run's artifacts. Whether it gates the merge is set by the
ruleset on `main`: its check is
`Compare the service with the metric / Compare the service with the metric (library pinned)`.

It exercises this repo's validation and calculation code only. The harness
imports the modules the validate route uses, straight from the checkout, and
runs them in process on a GeoPackage pair read from disk: the format gate, the
GEOS geometry checks, the data-quality checks, then sizing, extraction,
enrichment and the schema. Nothing is really uploaded: no HTTP request, no CDP
Uploader (so no S3 and no virus scan), no worker pool and no database. The
upload journey itself is covered by the journey tests. How the comparison
works, what it compares and what fails it are documented in the harness:
[docs/compare-metric.md](https://github.com/DEFRA/bng-metric-harness/blob/main/docs/compare-metric.md).

For the site report PDF — where its numbers and shapes come from, how it is checked
against PDF/UA, and how the Ordnance Survey basemap is credited — see
[`docs/site-report.md`](docs/site-report.md).

### Production

To mimic the application running in `production` mode locally run:

```bash
npm start
```

With `DB_IAM_AUTHENTICATION` on, the Postgres connection uses TLS with the
platform CA (`TRUSTSTORE_RDS_ROOT_CA`), and verifies the server certificate in
every CDP environment (`ENVIRONMENT` set and not `local`). Verification was
proved in perf-test, dev and test before it became the default. A certificate
that does not verify stops the service connecting to the database at all, so
check a new environment's `DB_HOST` is the RDS endpoint the certificate covers.
`DB_TLS_REJECT_UNAUTHORIZED` overrides the default either way; locally it is
off, where the database is a plain container.

### Npm scripts

All available Npm scripts can be seen in [package.json](./package.json).
To view them in your command line run:

```bash
npm run
```

### Update dependencies

To update dependencies use [npm-check-updates](https://github.com/raineorshine/npm-check-updates):

> The following script is a good start. Check out all the options on
> the [npm-check-updates](https://github.com/raineorshine/npm-check-updates)

```bash
ncu --interactive --format group
```

### Formatting

#### Windows prettier issue

If you are having issues with formatting of line breaks on Windows update your global git config by running:

```bash
git config --global core.autocrlf false
```

## Feature flags

A feature flag is an entry in `src/config.js` with the `strict-boolean` format,
read from an environment variable and **off by default in every environment**.
It is set per environment in cdp-app-config, so turning it on needs no release.
Read it where it is used, with `config.get(...)`, so a test can set it.

The tests run once per state of each flag, and both runs must pass on every
change: the flag-off run is the existing check, and the flag-on run is a second
check named after the flag.

| Flag                       | Config key                | What it does                                                                                    |
| :------------------------- | :------------------------ | :---------------------------------------------------------------------------------------------- |
| `SERVICE_TEMPLATE_ENABLED` | `serviceTemplate.enabled` | Take uploads in the BNG Service template and refuse the legacy template. Off takes legacy only. |

To run the tests with a flag on locally:

```bash
SERVICE_TEMPLATE_ENABLED=true npm test
```

## API endpoints

| Endpoint             | Description                    |
| :------------------- | :----------------------------- |
| `GET: /health`       | Health                         |
| `GET: /example    `  | Example API (remove as needed) |
| `GET: /example/<id>` | Example API (remove as needed) |

## Geometry validation

Uploaded GeoPackages are checked against sixteen geometry rules, which run
in-process on worker threads using GEOS compiled to WebAssembly. **Validation
takes no database connection.** The PostGIS statement that used to do this has
been removed; the database remains the system of record for storage.

There is no fallback. When the pool is saturated — or when the files already
being parsed have committed the parse budget — the route refuses **before**
downloading the file and returns **503 `VALIDATION_BUSY`**; the frontend keeps the
user on its polling page and retries, jittered, until a worker frees up or it
gives up after two minutes. The file was never looked at, so it is not a
validation failure.

| Setting                               | Default | Notes                                                              |
| :------------------------------------ | ------: | :----------------------------------------------------------------- |
| `VALIDATION_WORKER_COUNT`             |       2 | Capped at `availableParallelism() - 1`. ~250 MB each.              |
| `VALIDATION_WORKER_QUEUE_LIMIT`       |      20 | Waiting validations before new ones get a 503.                     |
| `VALIDATION_ADMISSION_LIMIT`          |      64 | Requests in flight at once. Reserved, so a burst cannot race it.   |
| `VALIDATION_WORKER_TIMEOUT_MS`        |    5000 | Per-job budget; the worker is terminated on overrun.               |
| `VALIDATION_QUEUE_WAIT_LIMIT_MS`      |    5000 | Longest a job may wait to start before it is refused.              |
| `VALIDATION_MAX_FEATURE_COUNT`        |   25000 | Features the gate accepts. Bigger files cannot finish in time.     |
| `VALIDATION_PARSE_BUDGET_BYTES`       |  550 MB | Heap rationed across files parsed at once. **The primary shed.**   |
| `VALIDATION_BUSY_RETRY_AFTER_SECONDS` |       5 | `Retry-After` on the 503; the frontend honours it.                 |
| `VALIDATION_MAX_RSS_BYTES`            | Derived | RSS above which new requests (not `/health`) get a 503. See below. |
| `UPLOAD_READY_TIMEOUT_MS`             |    2000 | Wait for CDP Uploader to report the file ready.                    |
| `UPLOAD_DOWNLOAD_TIMEOUT_MS`          |   10000 | Budget for streaming the file out of S3.                           |

Each worker settles at a few hundred MB of WebAssembly heap that is never
returned, so the worker count is a memory budget as much as a throughput setting.

Parsing is budgeted separately from validating, and this is the control that
actually does the shedding: across a full perf run it produced **310 of 316**
busy refusals, against 6 from the queue-wait limit and none from the queue depth
limit — the queue never filled, because the budget refuses first. Tune this
before `VALIDATION_WORKER_QUEUE_LIMIT`, which sits behind it as a backstop.

That ordering holds for **large** files only. A later saturation run showed the
opposite for small ones: a 143 KB file is charged ~3.5 MB against the budget, so
160 could be in flight before it refuses, and the depth limit is reached first.
That is why the depth limit is 20 rather than 8 — see "What a deep queue costs".

`VALIDATION_PARSE_BUDGET_BYTES` bounds how much parsed GeoPackage may be in
flight at once, charging each upload an estimated `~2 MB + 10x the file size`,
and the route reserves against it from the uploader's reported file size before
opening anything. The ratio is fitted to RSS per upload with eight held alive at
once, which is the regime the budget bounds: too tight and the service turns
away load it could carry, too loose and it does not refuse in time. (**RSS** is
resident set size — the memory the process holds in physical RAM, counting
native and WebAssembly allocations a JavaScript heap figure cannot see, and what
the task memory limit is enforced against.)

`VALIDATION_MAX_RSS_BYTES` is the backstop behind the parse budget. The budget
counts only the files being parsed, but most of the memory growth under load is
the workers' WebAssembly heaps and V8's retained heap, which it cannot see. When
the process RSS goes above this value, every new request except `/health` gets
the same 503 `VALIDATION_BUSY` the validate route gives when it is busy, so the
frontend retries, and the task sheds load instead of being killed by the kernel
at its memory limit — which would drop every in-flight request at once.
`/health` is never refused, so a task whose RSS stays high after a burst still
passes its health check.

Unset, it is worked out from the task: in a CDP environment the ceiling is the
task memory less `VALIDATION_PARSE_BUDGET_BYTES`, because the files already
admitted can still be unpacking when the ceiling is crossed, and the parse
budget is the most they can take. It therefore follows the task size, and there
is nothing to set per environment. A 4 GiB task gets about 3.7 GB, close to
the 3,718,250,496 bytes set by hand in perf-test; the exact figure is in the
boot log, because on Fargate the machine reports slightly less than the task
size. The task memory is the same figure the worker pool sizes itself from:
`process.constrainedMemory()` when it is a real limit, otherwise the machine's
memory, which on Fargate is the task. A "no limit" answer, which can be 0 or a
huge sentinel such as 2^64, counts as no limit. Locally it is off. Set it
to override the default, or to `0` to turn it off. A task too small for a
useful default (under 1 GiB of ceiling) leaves it off. The ceiling and where it
came from are logged at boot, and a CDP environment where it is off logs a
warning instead. RSS is sampled
every `VALIDATION_LOAD_SAMPLE_INTERVAL_MS` (1 s), so a few requests can pass
between samples.

The backend's timeouts are sequential stages of one request, so they **sum**,
and the total must fit inside the frontend's per-request validate timeout, which
must in turn fit inside the CDP ingress idle timeout.

See [`docs/geometry-validation.md`](docs/geometry-validation.md).

For how the service behaves when Postgres, S3 or CDP Uploader fails, and the
tests that show it, see [`docs/downstream-failures.md`](docs/downstream-failures.md).

## Rate limits

CDP's Nginx allows 1000 requests a second. The routes that cost the most to
serve cannot carry that, so each has two limits, from
[`hapi-rate-limit`](https://github.com/wraithgar/hapi-rate-limit): one for
each user (the token's `sub` claim), and one for all users together. Every
other route, `/health` and `/upload/{uploadId}/status` included, has no limit
of its own; the CDP limit protects them.

| Routes                                                                                     | Config section             | Each user | All users | Window |
| :----------------------------------------------------------------------------------------- | :------------------------- | --------: | --------: | -----: |
| `POST /upload/initiate`                                                                    | `rateLimit.uploadInitiate` |        10 |        60 |  1 min |
| `POST /baseline/validate/{uploadId}`, `POST /post-intervention/validate/{uploadId}` (each) | `rateLimit.validate`       |        40 |       120 |  1 min |
| `GET /projects/{projectId}/report.pdf`                                                     | `rateLimit.report`         |         5 |        20 |  1 min |
| `GET /os-tiles/*` (each of the 4 routes; they spend the OS API quota)                      | `rateLimit.osTiles`        |       600 |      3000 |  1 min |

The values are estimates. The rate-limit profile of the performance tests
(bng-perf-tests) confirms or changes them.

Each value has its own environment variable, `RATE_LIMIT_<FAMILY>_USER_LIMIT`,
`RATE_LIMIT_<FAMILY>_ALL_USERS_LIMIT` and `RATE_LIMIT_<FAMILY>_WINDOW_MS`, where
`<FAMILY>` is `UPLOAD_INITIATE`, `VALIDATE`, `REPORT` or `OS_TILES`.

| Setting                         | Default | Notes                                                                 |
| :------------------------------ | ------: | :-------------------------------------------------------------------- |
| `RATE_LIMIT_ENABLED`            |  `true` | `false` turns every limit off. Set per environment in cdp-app-config. |
| `RATE_LIMIT_REPORT_INTERVAL_MS` |   60000 | How often refused requests are logged and counted.                    |

`RATE_LIMIT_ENABLED` is on by default, unlike a feature flag. It is off in two
places, because they send more than the limits as one user on purpose:

- the performance test environment while a capacity profile (`standard` or
  `short`) runs. It is on while the `rate-limit` profile runs. The setting is
  in cdp-app-config, so the backend must be deployed again before each profile;
- the journey test stack (bng-metric-journey-tests) and this repository's
  integration tests.

A refused request gets **429 Too Many Requests** with a `Retry-After` header:
the seconds until the limit that refused it resets. The frontend shows its
"too many requests" page with that wait.

What to know about the counts:

- They are in memory (the default server cache). The backend has no Redis, so
  **each copy of the backend counts on its own**. That is right for the
  all-users limit, because each copy has its own capacity, but it means a
  user can make up to the user limit **multiplied by the number of copies**.
- A window starts at a key's first request and does not slide.
- The plugin counts refused requests too, and a user's requests count toward
  the all-users limit even when that user is over their own. One user who
  keeps sending can therefore use up the all-users limit for everybody until
  the window ends.

Where they sit among the load controls: the memory ceiling
(`VALIDATION_MAX_RSS_BYTES`) refuses first, before authentication. The rate
limits are checked after authentication and before the handler, so before the
validate route's admission limit, parse budget and worker queue. They replace
none of them. The validate limit for each user is well above the frontend's
busy-and-retry journey, which calls validate at most about 13 times a minute
(every 5 to 8 seconds for up to 2 minutes).

Refused requests are counted by route and type of limit, and once each
`RATE_LIMIT_REPORT_INTERVAL_MS` the backend writes one warning log line and
one `RateLimitRequestsRefused` metric for each, with the dimensions `route`
(the route pattern, e.g. `/projects/{projectId}/report.pdf`) and `limit`
(`user` or `all_users`). Neither records the user. See
`src/plugins/rate-limit.js`.

## Development helpers

### Proxy

We are using forward-proxy which is set up by default. To make use of this: `import { fetch } from 'undici'` then
because of the `setGlobalDispatcher(new ProxyAgent(proxyUrl))` calls will use the ProxyAgent Dispatcher

If you are not using Wreck, Axios or Undici or a similar http that uses `Request`. Then you may have to provide the
proxy dispatcher:

To add the dispatcher to your own client:

```javascript
import { ProxyAgent } from 'undici'

return await fetch(url, {
  dispatcher: new ProxyAgent({
    uri: proxyUrl,
    keepAliveTimeout: 10,
    keepAliveMaxTimeout: 10
  })
})
```

## Docker

### Development image

Build:

```bash
docker build --target development --no-cache --tag bng-metric-backend:development .
```

Run:

```bash
docker run -e PORT=3001 -p 3001:3001 bng-metric-backend:development
```

### Production image

Build:

```bash
docker build --no-cache --tag bng-metric-backend .
```

Run:

```bash
docker run -e PORT=3001 -p 3001:3001 bng-metric-backend
```

### Docker Compose

A local environment with:

- Localstack for AWS services (S3, SQS)
- Redis
- This service.
- A commented out frontend example.

```bash
docker compose up --build -d
```

### Dependabot

We have added an example dependabot configuration file to the repository. You can enable it by renaming
the [.github/example.dependabot.yml](.github/example.dependabot.yml) to `.github/dependabot.yml`

### SonarCloud

Instructions for setting up SonarCloud can be found in [sonar-project.properties](./sonar-project.properties)

## Security: Secret scanning

This repo scans for secrets at three independent layers — a real credential has to slip past all three to reach `main`:

| Layer        | When         | What runs                                                                         |
| ------------ | ------------ | --------------------------------------------------------------------------------- |
| pre-commit   | `git commit` | `gitleaks protect --staged` on the staged diff (< 200ms)                          |
| pre-push     | `git push`   | `gitleaks detect` on `@{u}..HEAD` (catches `--no-verify`), then integration tests |
| CI (PR-gate) | every PR     | `gitleaks-action` + `trufflehog --only-verified`                                  |

### Setup

`npm install && npm run postinstall` — `.npmrc` sets `ignore-scripts=true` (see below), so the `postinstall` script that configures `husky` no longer fires automatically and has to be run once by hand. It also runs `scripts/install-gitleaks.mjs`, which downloads a pinned gitleaks binary into `node_modules/.gitleaks/bin/` (verifies SHA-256; reuses any system `gitleaks` already on `PATH`). No `brew install` needed.

#### Why `ignore-scripts`

`ignore-scripts=true` in `.npmrc` blocks npm from auto-running preinstall/install/postinstall/prepare scripts for this package and every dependency — the mechanism behind npm supply-chain worms (e.g. Shai-Hulud) that execute arbitrary code the moment a compromised package is installed. It applies uniformly to local installs, CI, and Docker builds, since all three read this committed `.npmrc`.

Scripts run explicitly via `npm run <name>` (like `postinstall` above) are unaffected — only npm's automatic triggering during install is disabled. If a dependency genuinely needs its own install script to function (e.g. to build a native addon), run it for just that package with `npm rebuild <package>`, or override for a single command with `npm install --ignore-scripts=false`. Note the override and its justification in the PR, and record any standing exception in Confluence.

If the download fails (firewall/offline), the hook falls back to a system `gitleaks` on `PATH`. Manual install:

```bash
brew install gitleaks            # macOS
sudo apt install gitleaks        # Debian/Ubuntu
choco install gitleaks           # Windows
```

### Allowlisted dev placeholders

`.gitleaks.toml` carries an allowlist for the documented LocalStack / Postgres dev placeholders that appear in `.env.template`, `compose.yml`, `compose/aws.env`, and the CI workflow env blocks:

- `POSTGRES_PASSWORD: dev` / `POSTGRES_USER: dev`
- `AWS_ACCESS_KEY_ID=test` / `AWS_SECRET_ACCESS_KEY=test`

These are deliberate, non-secret fixtures (LocalStack accepts any `test`/`test` AWS creds). If a real credential ever needs the same shape, change the value — don't widen the allowlist.

### Adding a new allowlist entry

Edit `.gitleaks.toml` and open a PR — a security-aware reviewer must approve the widening. See [CODEOWNERS](.github/CODEOWNERS) for current owners.

### Emergency bypass

```bash
SKIP_GITLEAKS_INSTALL=1 npm install   # skip binary download
git commit --no-verify                # skip local pre-commit
git push --no-verify                  # skip local pre-push
```

CI still runs the same scans on the PR and **will block the merge**. Don't rely on `--no-verify` to land a real secret.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
