# Backend auth route policy — secure by default

Every backend route requires a verified Defra ID bearer token **by default**.
A route is public only if it explicitly opts out _and_ is listed on a reviewed
allowlist. This makes authentication the default and the absence of auth a
deliberate, visible decision — forgetting to add auth fails **closed**, not open.

## The mechanism

`src/server.js` registers the `defra-jwt` strategy (see
[`src/plugins/auth-jwt.js`](../src/plugins/auth-jwt.js)) and then sets it as the
**server-wide default**, before the router registers any routes:

```js
server.auth.default('defra-jwt')
```

`defra-jwt` independently verifies the forwarded id_token against the provider's
JWKS (zero-trust — the backend never trusts frontend-parsed claims). See
[the frontend authenticated-user-journey doc](../../bng-metric-frontend/docs/authenticated-user-journey.md)
for the end-to-end flow.

Because the default is set before routes are added, **a new route is protected
automatically** — you do not need to write `auth: 'defra-jwt'` on it (existing
routes that still do are redundant but harmless, and read as explicit intent).

### How Hapi applies the default (important when reading the route table)

Hapi applies the default at **request time**, not by stamping each route. So in
`server.table()`:

| Route kind                            | `route.settings.auth`                             | Protected at runtime?          |
| ------------------------------------- | ------------------------------------------------- | ------------------------------ |
| Relies on the default (no `auth` set) | `undefined`                                       | **Yes** — inherits the default |
| Explicit `auth: 'defra-jwt'`          | `{ strategies: ['defra-jwt'], mode: 'required' }` | Yes                            |
| Public opt-out                        | `false`                                           | No (intentional)               |

This is why the guard test (below) treats `undefined` as "inherits the secure
default" and proves enforcement with a live request rather than only inspecting
settings.

## Making a route public

Public routes must do **both**:

1. Set `options: { auth: false }` on the route.
2. Be added to `PUBLIC_ROUTES` in
   [`integration-tests/auth-coverage.test.js`](../integration-tests/auth-coverage.test.js)
   with a one-line justification.

If you do only (1), the guard test fails. This keeps every public surface
reviewed.

### Current public routes

| Route                         | Why it is public                                                                                                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                 | CDP liveness/readiness probe — must be unauthenticated                                                                                        |
| `GET /reference/*` (8 routes) | Static lookup data (habitat types, conditions, trading rules) bundled into the engine at build time; no per-user scope, nothing sensitive     |
| `GET /db-info`                | Local/dev DB-version diagnostic — **never registered in production** (see below); `auth: false` so it works without a token where it does run |

Swagger docs routes (`/docs*`, `/swagger.json`) also set `auth: false`, but they
are only registered when `USE_SWAGGER=true` (off in production), so they are not
on the runtime allowlist.

## Routes removed from production

`/db-info` is a database-introspection endpoint. Rather than ship it to
production behind auth, it is **removed from the prod route table entirely** —
`src/plugins/router.js` registers it only when `cdpEnvironment !== 'prod'`. In
production the path simply does not exist (404), so it is not an attack surface
at all.

## The guard test

[`integration-tests/auth-coverage.test.js`](../integration-tests/auth-coverage.test.js)
walks the live route table and fails the build if:

- a route sets `auth: false` but is **not** on `PUBLIC_ROUTES`;
- a route has an explicit auth config that does **not** require `defra-jwt`;
- the inherited default stops enforcing (a route relying on the default no
  longer returns `401` without a token) — this catches accidental removal or
  weakening of `server.auth.default('defra-jwt')`.

It also asserts, with live requests, that a default-covered route, an
explicitly-protected route, and a public route each behave correctly.

## Checklist for adding an endpoint

1. Write the route. Do **nothing** for auth — it is protected by the default.
2. Derive identity from `request.auth.credentials` (the verified token), never
   from the request body. For owned resources, filter with
   [`visibleToUser`](../src/db/project-visibility.js).
3. Only if the endpoint is genuinely public: add `options: { auth: false }` and
   an entry in `PUBLIC_ROUTES` with a justification.
4. Run `npm run test:integration` — the guard test confirms coverage.
