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

COPY --chown=node:node package*.json ./
# Workspace dependency (bng-metric-engine) must be present before npm install —
# "workspace:*" cannot be resolved from the root package.json alone.
COPY --chown=node:node bng-metric-engine/package.json ./bng-metric-engine/
# Strip our postinstall hook (dev-only husky/gitleaks setup) before install —
# scripts/ is not in this image, and the hooks are not needed inside the container.
RUN npm pkg delete scripts.postinstall && npm install
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
RUN npm pkg delete scripts.postinstall && npm prune --omit=dev

COPY --chown=node:node --from=development /home/node/src ./src/

ARG PORT
ENV PORT=${PORT}
EXPOSE ${PORT}

CMD [ "node", "src" ]
