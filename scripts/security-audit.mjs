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

/** The `npm audit --json` report format this reads (npm 7 and later). */
const AUDIT_REPORT_VERSION = 2

function spawnNpmAudit() {
  return spawnSync(NPM, ['audit', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_REPORT_BYTES,
    // Node runs a .cmd only through a shell.
    shell: IS_WINDOWS
  })
}

/**
 * The report a `npm audit --json` run gave, or the problem that stops it
 * being judged: npm not starting, output that is not JSON, npm's own error,
 * or a report in a format this does not read. Each fails the audit, so a run
 * that checked nothing never passes.
 *
 * @param {{ error?: Error, stdout?: string | null, stderr?: string | null }} result what spawnSync returned
 * @returns {{ report: object } | { problem: string }}
 */
export function readReport(result) {
  if (result.error) {
    return { problem: `npm audit could not run: ${result.error.message}` }
  }
  let report
  try {
    report = JSON.parse(result.stdout ?? '')
  } catch {
    return {
      problem: `npm audit did not return a report:\n${result.stderr || result.stdout}`
    }
  }
  if (report?.error) {
    return { problem: `npm audit failed: ${report.error.summary}` }
  }
  const readable =
    report?.auditReportVersion === AUDIT_REPORT_VERSION &&
    typeof report.vulnerabilities === 'object' &&
    report.vulnerabilities !== null
  return readable
    ? { report }
    : {
        problem: `npm audit returned a report this does not read (auditReportVersion ${report?.auditReportVersion}); it reads version ${AUDIT_REPORT_VERSION}, from npm 7 or later`
      }
}

function printOutcome({ blocking, ignored, unused }, console) {
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
  if (blocking.length === 0) {
    console.log('[security-audit] No high or critical advisories to act on.')
    return
  }
  console.error(
    `[security-audit] High or critical advisories (${blocking.length}). Upgrade each package, or run npm audit to see its fix:`
  )
  for (const advisory of blocking) {
    console.error(
      `  ${advisory.severity} ${advisory.package}: ${advisory.title} ${advisory.url}`
    )
  }
}

/**
 * Run the audit and say what it found. The exit status is the gate CI and the
 * pre-commit hook rely on: 0 only when npm reported in full and nothing but
 * allowlisted advisories is high or critical.
 *
 * @param {object} [options]
 * @param {Array<{ id: string }>} [options.allowlist]
 * @param {() => object} [options.runNpmAudit] returns what spawnSync does
 * @param {Pick<Console, 'log' | 'warn' | 'error'>} [options.console]
 * @returns {0 | 1} the exit status
 */
export function securityAudit({
  allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8')),
  runNpmAudit = spawnNpmAudit,
  console = globalThis.console
} = {}) {
  const read = readReport(runNpmAudit())
  if (read.problem) {
    console.error(`[security-audit] ${read.problem}`)
    return 1
  }
  const outcome = judge(read.report, allowlist)
  printOutcome(outcome, console)
  return outcome.blocking.length === 0 ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = securityAudit()
}
