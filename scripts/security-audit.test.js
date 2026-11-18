import { describe, expect, it } from 'vitest'

import { advisories, judge } from './security-audit.mjs'

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
    expect(advisories({ vulnerabilities: {} })).toEqual([])
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
