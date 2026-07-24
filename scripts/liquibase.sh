#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-update}"
CHANGELOG_DIR="$(cd "$(dirname "$0")/../changelog" && pwd)"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Pin the JDBC driver directly — LPM's package-manifest checksums periodically
# drift from republished Maven artifacts ("Checksum validation failed").
POSTGRES_JDBC_VERSION="${POSTGRES_JDBC_VERSION:-42.7.8}"
DRIVER_CACHE_DIR="${REPO_ROOT}/.cache/liquibase"
DRIVER_JAR="${DRIVER_CACHE_DIR}/postgresql-${POSTGRES_JDBC_VERSION}.jar"
DRIVER_URL="https://repo1.maven.org/maven2/org/postgresql/postgresql/${POSTGRES_JDBC_VERSION}/postgresql-${POSTGRES_JDBC_VERSION}.jar"

mkdir -p "${DRIVER_CACHE_DIR}"
if [[ ! -f "${DRIVER_JAR}" ]]; then
  curl -fsSL --proto '=https' --tlsv1.2 "${DRIVER_URL}" -o "${DRIVER_JAR}"
fi

docker run --rm \
  --network cdp-tenant \
  --entrypoint sh \
  -v "${CHANGELOG_DIR}:/liquibase/changelog" \
  -v "${DRIVER_JAR}:/liquibase/lib/postgresql-${POSTGRES_JDBC_VERSION}.jar:ro" \
  liquibase/liquibase \
  -c "liquibase --changelog-file=changelog/db.changelog.xml --url=jdbc:postgresql://postgres:5432/bng_metric_backend --username=dev --password=dev ${COMMAND}"
