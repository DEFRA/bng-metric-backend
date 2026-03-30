#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-update}"
CHANGELOG_DIR="$(cd "$(dirname "$0")/../changelog" && pwd)"

docker run --rm \
  --network cdp-tenant \
  --entrypoint sh \
  -v "${CHANGELOG_DIR}:/liquibase/changelog" \
  liquibase/liquibase \
  -c "lpm add postgresql --global && liquibase --changelog-file=changelog/db.changelog.xml --url=jdbc:postgresql://postgres:5432/bng_metric_backend --username=dev --password=dev ${COMMAND}"
