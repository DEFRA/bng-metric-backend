import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  advisories,
  judge,
  readReport,
  securityAudit
} from './security-audit.mjs'

const PICOMATCH = {
  source: 1111,
  name: 'picomatch',
  title:
    'picomatch vulnerable to ReDoS through single-branch repeated extglobs',
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  severity: 'high'
}
const FAST_URI = {
  source: 2222,
  name: 'fast-uri',
  title: 'fast-uri vulnerable to URI scheme spoofing',
  url: 'https://github.com/advisories/GHSA-w74x-v6f9-j3xg',
  severity: 'moderate'
}
const LODASH = {
  source: 3333,
  name: 'lodash',
  title: 'Prototype pollution in lodash',
  url: 'https://github.com/advisories/GHSA-p6mc-m468-83gw',
  severity: 'critical'
}

/** A `npm audit --json` report with each advisory, and vite flagged through picomatch. */
const report = (...vias) => ({
  auditReportVersion: 2,
  vulnerabilities: {
    ...Object.fromEntries(
      vias.map((via) => [
        via.name,
        { name: via.name, severity: via.severity, via: [via] }
      ])
    ),
    vite: { name: 'vite', severity: 'high', via: ['picomatch'] }
  }
})

const ALLOWLIST = [{ id: 'GHSA-fc5q-39xc-vjpf', package: 'picomatch' }]

describe('advisories', () => {
  it('names each advisory by its GitHub id, and none for a package flagged only through a dependency', () => {
    expect(advisories(report(PICOMATCH, FAST_URI))).toEqual([
      {
        id: 'GHSA-fc5q-39xc-vjpf',
        package: 'picomatch',
        severity: 'high',
        title: PICOMATCH.title,
        url: PICOMATCH.url
      },
      {
        id: 'GHSA-w74x-v6f9-j3xg',
        package: 'fast-uri',
        severity: 'moderate',
        title: FAST_URI.title,
        url: FAST_URI.url
      }
    ])
  })

  it('reads a report with no vulnerabilities as none', () => {
    expect(advisories({ auditReportVersion: 2, vulnerabilities: {} })).toEqual(
      []
    )
  })
})

describe('judge', () => {
  it('passes an allowlisted high advisory and the packages flagged through it', () => {
    expect(judge(report(PICOMATCH, FAST_URI), ALLOWLIST)).toEqual({
      blocking: [],
      ignored: ALLOWLIST,
      unused: []
    })
  })

  it('fails on any other high or critical advisory', () => {
    const { blocking } = judge(report(PICOMATCH, LODASH), ALLOWLIST)

    expect(blocking.map((advisory) => advisory.id)).toEqual([
      'GHSA-p6mc-m468-83gw'
    ])
  })

  it('fails on another high advisory in the allowlisted advisory’s package: the exception is for one advisory, not the package', () => {
    const other = {
      ...PICOMATCH,
      source: 4444,
      title: 'Another picomatch advisory',
      url: 'https://github.com/advisories/GHSA-2222-3333-4444'
    }
    const bothInPicomatch = {
      auditReportVersion: 2,
      vulnerabilities: {
        picomatch: {
          name: 'picomatch',
          severity: 'high',
          via: [PICOMATCH, other]
        }
      }
    }

    const { blocking, ignored } = judge(bothInPicomatch, ALLOWLIST)

    expect(blocking.map((advisory) => advisory.id)).toEqual([
      'GHSA-2222-3333-4444'
    ])
    expect(ignored).toEqual(ALLOWLIST)
  })

  it('fails on the allowlisted advisory when the allowlist is empty', () => {
    const { blocking } = judge(report(PICOMATCH), [])

    expect(blocking.map((advisory) => advisory.package)).toEqual(['picomatch'])
  })

  it('names an allowlist entry npm no longer reports, so it can be removed', () => {
    expect(judge(report(FAST_URI), ALLOWLIST)).toEqual({
      blocking: [],
      ignored: [],
      unused: ALLOWLIST
    })
  })
})

/** What spawnSync returns for a run that printed `report` as JSON. */
const ran = (printed) => ({
  status: 1,
  stdout: typeof printed === 'string' ? printed : JSON.stringify(printed),
  stderr: ''
})

/** Every run that must fail the audit because nothing could be judged. */
const UNREADABLE_RUNS = [
  [
    'npm cannot be started',
    { error: new Error('spawnSync npm ENOENT'), stdout: null, stderr: null },
    'npm audit could not run: spawnSync npm ENOENT'
  ],
  [
    'npm prints something other than JSON',
    { status: 1, stdout: 'npm ERR! network', stderr: 'npm ERR! network' },
    'npm audit did not return a report'
  ],
  [
    'npm prints nothing',
    { status: 1, stdout: '', stderr: '' },
    'npm audit did not return a report'
  ],
  [
    'npm reports its own error',
    ran({
      error: { code: 'ENOLOCK', summary: 'This command requires a lockfile' }
    }),
    'npm audit failed: This command requires a lockfile'
  ],
  [
    'npm 6 prints its version 1 report',
    ran({ auditReportVersion: 1, advisories: {} }),
    'auditReportVersion 1'
  ],
  [
    'the report has no vulnerabilities',
    ran({ auditReportVersion: 2 }),
    'auditReportVersion 2'
  ],
  ['npm prints null', ran('null'), 'auditReportVersion undefined']
]

describe('readReport', () => {
  it('reads a version 2 report', () => {
    const printed = report(PICOMATCH)

    expect(readReport(ran(printed))).toEqual({ report: printed })
  })

  it.each(UNREADABLE_RUNS)('gives a problem when %s', (_, result, problem) => {
    expect(readReport(result).problem).toContain(problem)
  })
})

describe('securityAudit', () => {
  const quietConsole = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() })
  const audit = (result, allowlist = ALLOWLIST) => {
    const console = quietConsole()
    const status = securityAudit({
      allowlist,
      runNpmAudit: () => result,
      console
    })
    return { status, console }
  }

  it('exits 0 when only allowlisted advisories are high, saying what it ignored', () => {
    const { status, console } = audit(ran(report(PICOMATCH, FAST_URI)), [
      { ...ALLOWLIST[0], reason: 'dev tooling only' }
    ])

    expect(status).toBe(0)
    expect(console.log).toHaveBeenCalledWith(
      '[security-audit] Ignoring GHSA-fc5q-39xc-vjpf (picomatch): dev tooling only'
    )
    expect(console.error).not.toHaveBeenCalled()
  })

  it('exits 1 on a high or critical advisory it does not allow, naming it', () => {
    const { status, console } = audit(ran(report(PICOMATCH, LODASH)))

    expect(status).toBe(1)
    expect(console.error).toHaveBeenCalledWith(
      `  critical lodash: ${LODASH.title} ${LODASH.url}`
    )
  })

  it('warns of an allowlist entry npm no longer reports, and still exits 0', () => {
    const { status, console } = audit(ran(report(FAST_URI)))

    expect(status).toBe(0)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('no longer reports GHSA-fc5q-39xc-vjpf')
    )
  })

  it.each(UNREADABLE_RUNS)(
    'exits 1 when %s, saying why',
    (_, result, problem) => {
      const { status, console } = audit(result)

      expect(status).toBe(1)
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(problem)
      )
    }
  )
})

// The command itself, run as CI runs it, against an npm that prints a fixed
// report: its exit status is the gate.
describe.skipIf(process.platform === 'win32')('npm run security-audit', () => {
  const fakeBin = mkdtempSync(path.join(tmpdir(), 'security-audit-'))
  afterAll(() => rmSync(fakeBin, { recursive: true, force: true }))

  function runWith(printed) {
    const output = path.join(fakeBin, 'report.json')
    writeFileSync(output, printed)
    const npm = path.join(fakeBin, 'npm')
    writeFileSync(npm, `#!/bin/sh\ncat '${output}'\nexit 1\n`)
    chmodSync(npm, 0o755)
    return spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, 'security-audit.mjs')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`
        }
      }
    )
  }

  it('exits 0 when only the advisories in audit-allowlist.json are high', () => {
    const result = runWith(JSON.stringify(report(PICOMATCH, FAST_URI)))

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Ignoring GHSA-fc5q-39xc-vjpf')
  })

  it('exits 1 on any other high or critical advisory', () => {
    const result = runWith(JSON.stringify(report(PICOMATCH, LODASH)))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('critical lodash')
  })

  it('exits 1 when npm prints no report', () => {
    const result = runWith('npm ERR! network')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('npm audit did not return a report')
  })
})
