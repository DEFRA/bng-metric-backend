// `npm run security-audit`: fail on any high or critical npm advisory, except
// the ones audit-allowlist.json names. npm audit cannot skip one advisory on
// its own, so this runs it as JSON and judges each advisory by its GitHub id.
// An allowlisted advisory npm no longer reports is named, so its entry can go.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const ALLOWLIST = path.join(REPO_ROOT, 'audit-allowlist.json')
const IS_WINDOWS = process.platform === 'win32'
const NPM = IS_WINDOWS ? 'npm.cmd' : 'npm'
const BLOCKING_SEVERITIES = new Set(['high', 'critical'])
const ADVISORY_ID = /GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}/
// A full report for a large tree runs to a few megabytes.
const MAX_REPORT_BYTES = 64 * 1024 * 1024

/**
 * Each advisory a `npm audit --json` report names, once per id and package.
 * A package flagged only through a dependency (`via` a package name) adds
 * none of its own: its dependency's advisory is the one to judge.
 *
 * @param {object} report
 * @returns {Array<{ id: string, package: string, severity: string, title: string, url: string }>}
 */
export function advisories(report) {
  const found = new Map()
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability.via ?? []) {
      if (typeof via !== 'object') {
        continue
      }
      const id = via.url?.match(ADVISORY_ID)?.[0] ?? String(via.source)
      found.set(`${id} ${via.name}`, {
        id,
        package: via.name,
        severity: via.severity,
        title: via.title,
        url: via.url
      })
    }
  }
  return [...found.values()]
}

/**
 * The advisories that fail the audit, and the allowlist entries no advisory
 * in the report matched.
 *
 * @param {object} report a `npm audit --json` report
 * @param {Array<{ id: string }>} allowlist
 */
export function judge(report, allowlist) {
  const allowed = new Set(allowlist.map((entry) => entry.id))
  const reported = advisories(report)
  const seen = new Set(reported.map((advisory) => advisory.id))
  return {
    blocking: reported.filter(
      (advisory) =>
        BLOCKING_SEVERITIES.has(advisory.severity) && !allowed.has(advisory.id)
    ),
    ignored: allowlist.filter((entry) => seen.has(entry.id)),
    unused: allowlist.filter((entry) => !seen.has(entry.id))
  }
}

function runAudit() {
  const result = spawnSync(NPM, ['audit', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_REPORT_BYTES,
    // Node runs a .cmd only through a shell.
    shell: IS_WINDOWS
  })
  try {
    return JSON.parse(result.stdout)
  } catch {
    console.error(result.stderr || result.stdout)
    console.error('[security-audit] npm audit did not return a report.')
    process.exit(1)
  }
}

function main() {
  const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8'))
  const report = runAudit()
  if (report.error) {
    console.error(`[security-audit] npm audit failed: ${report.error.summary}`)
    process.exit(1)
  }
  const { blocking, ignored, unused } = judge(report, allowlist)

  for (const entry of ignored) {
    console.log(
      `[security-audit] Ignoring ${entry.id} (${entry.package}): ${entry.reason}`
    )
  }
  for (const entry of unused) {
    console.warn(
      `[security-audit] npm audit no longer reports ${entry.id} (${entry.package}). Remove it from audit-allowlist.json.`
    )
  }
  if (blocking.length > 0) {
    console.error(
      `[security-audit] High or critical advisories (${blocking.length}). Upgrade each package, or run npm audit to see its fix:`
    )
    for (const advisory of blocking) {
      console.error(
        `  ${advisory.severity} ${advisory.package}: ${advisory.title} ${advisory.url}`
      )
    }
    process.exit(1)
  }
  console.log('[security-audit] No high or critical advisories to act on.')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
}
