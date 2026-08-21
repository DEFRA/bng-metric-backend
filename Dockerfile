ARG PARENT_VERSION=3.0.5-node24.14.1
ARG PORT=3000
ARG PORT_DEBUG=9229

FROM defradigital/node-development:${PARENT_VERSION} AS development
ARG PARENT_VERSION
LABEL uk.gov.defra.ffc.parent-image=defradigital/node-development:${PARENT_VERSION}

ARG PORT
ARG PORT_DEBUG
ENV PORT=${PORT}
EXPOSE ${PORT} ${PORT_DEBUG}

COPY --chown=node:node package*.json .npmrc ./
# Workspace dependency (bng-metric-engine) must be present before npm install —
# "workspace:*" cannot be resolved from the root package.json alone.
COPY --chown=node:node bng-metric-engine/package.json ./bng-metric-engine/
# Strip our postinstall hook (dev-only husky/gitleaks setup) before install —
# scripts/ is not in this image, and the hooks are not needed inside the container.
# --ignore-scripts also blocks any dependency's own install scripts (belt-and-braces
# with .npmrc's ignore-scripts=true, which some static analysis can't see into a file).
# min-release-age collides with the git-dependency prepare step npm always attempts for
# bng-library (npm/cli#9005), same as the CI workaround in check-pull-request.yml.
RUN sed -i '/^min-release-age=/d' .npmrc && \
    npm pkg delete scripts.postinstall && npm install --ignore-scripts
COPY --chown=node:node ./src ./src
# Engine runtime is src/ only; scripts/ are dev/CLI helpers and are not deployed.
COPY --chown=node:node ./bng-metric-engine/src ./bng-metric-engine/src

CMD [ "npm", "run", "docker:dev" ]

FROM defradigital/node:${PARENT_VERSION} AS production
ARG PARENT_VERSION
LABEL uk.gov.defra.ffc.parent-image=defradigital/node:${PARENT_VERSION}

# Add curl to template.
# CDP PLATFORM HEALTHCHECK REQUIREMENT
USER root
RUN apk add --no-cache curl
USER node

COPY --chown=node:node --from=development /home/node/package*.json ./
COPY --chown=node:node --from=development /home/node/bng-metric-engine/package.json ./bng-metric-engine/
COPY --chown=node:node --from=development /home/node/node_modules ./node_modules
COPY --chown=node:node --from=development /home/node/bng-metric-engine ./bng-metric-engine/

# Reuse the development install and prune dev dependencies locally — avoids a second
# registry-bound `npm ci` in CI, where transient ECONNRESET failures are common.
RUN npm pkg delete scripts.postinstall && npm prune --omit=dev --ignore-scripts

COPY --chown=node:node --from=development /home/node/src ./src/

ARG PORT
ENV PORT=${PORT}
EXPOSE ${PORT}

# Cap V8's old space so a spike in concurrent GeoPackage uploads fails the
# offending request with a JS heap error the route can turn into a 500, rather
# than the kernel OOM-killing the process and taking every other user's
# validation down with it (BMD-913). Keep this comfortably below the container
# memory limit — the rest of RSS (native better-sqlite3 pages, stream buffers,
# the Node runtime itself) lives outside the old space. Override per
# environment by setting NODE_OPTIONS in the CDP Portal.
ARG NODE_MAX_OLD_SPACE_SIZE_MB=1024
ENV NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE_SIZE_MB}"

CMD [ "node", "src" ]
