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

### Production

To mimic the application running in `production` mode locally run:

```bash
npm start
```

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

## API endpoints

| Endpoint             | Description                    |
| :------------------- | :----------------------------- |
| `GET: /health`       | Health                         |
| `GET: /example    `  | Example API (remove as needed) |
| `GET: /example/<id>` | Example API (remove as needed) |

## Geometry validation

Uploaded GeoPackages are checked against fifteen geometry rules, which run
in-process on worker threads using GEOS compiled to WebAssembly. **Validation
takes no database connection.** The PostGIS statement that used to do this has
been removed; the database remains the system of record for storage.

There is no fallback. When the pool is saturated — or when the files already
being parsed have committed the parse budget — the route refuses **before**
downloading the file and returns **503 `VALIDATION_BUSY`**; the frontend keeps the
user on its polling page and retries, jittered, until a worker frees up or it
gives up after two minutes. The file was never looked at, so it is not a
validation failure.

| Setting                               | Default | Notes                                                            |
| :------------------------------------ | ------: | :--------------------------------------------------------------- |
| `VALIDATION_WORKER_COUNT`             |       2 | Capped at `availableParallelism() - 1`. ~250 MB each.            |
| `VALIDATION_WORKER_QUEUE_LIMIT`       |       8 | Waiting validations before new ones get a 503.                   |
| `VALIDATION_WORKER_TIMEOUT_MS`        |   10000 | Per-job budget; the worker is terminated on overrun.             |
| `VALIDATION_QUEUE_WAIT_LIMIT_MS`      |    5000 | Longest a job may wait to start before it is refused.            |
| `VALIDATION_PARSE_BUDGET_BYTES`       |  550 MB | Heap rationed across files parsed at once. **The primary shed.** |
| `VALIDATION_BUSY_RETRY_AFTER_SECONDS` |       5 | `Retry-After` on the 503; the frontend honours it.               |
| `UPLOAD_READY_TIMEOUT_MS`             |    3000 | Wait for CDP Uploader to report the file ready.                  |
| `UPLOAD_DOWNLOAD_TIMEOUT_MS`          |   10000 | Budget for streaming the file out of S3.                         |

Each worker settles at a few hundred MB of WebAssembly heap that is never
returned, so the worker count is a memory budget as much as a throughput setting.

Parsing is budgeted separately from validating, and this is the control that
actually does the shedding: across a full perf run it produced **310 of 316**
busy refusals, against 6 from the queue-wait limit and none from the queue depth
limit — the queue never filled, because the budget refuses first. Tune this
before `VALIDATION_WORKER_QUEUE_LIMIT`, which sits behind it as a backstop.

`VALIDATION_PARSE_BUDGET_BYTES` bounds how much parsed GeoPackage may be in
flight at once, charging each upload an estimated `~8 MB + 14x the file size`,
and the route reserves against it from the uploader's reported file size before
opening anything.

That `14x` is **unverified**. Measured against the 9.3 MB / 16,801-feature
fixture, a full read retains ~50 MB — nearer 5x, and mostly attributes rather
than shapes — while repeated reads pushed RSS ~237 MB above baseline. The two
measurements disagree, and neither was taken under concurrency, which is what
the budget bounds. Re-derive it from N simultaneous validations before relying
on it: too tight and the service turns away load it could carry, too loose and
it does not refuse in time.

These timeouts form a ladder that must nest inside the frontend's per-request
validate timeout, which must in turn nest inside the CDP ingress idle timeout.

See [`docs/geometry-validation.md`](docs/geometry-validation.md).

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
