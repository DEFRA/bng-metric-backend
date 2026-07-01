#!/usr/bin/env node

import { calculateRetainedHedgerowPostIntervention } from '../src/hedgerow-post-intervention.js'
import {
  exitWithUsage,
  parsePositiveNumber,
  parseRetainedPositionalArgs,
  resolveArgvMode,
  runCli
} from './post-intervention-cli-shared.js'

const SCRIPT =
  'bng-metric-engine/scripts/calc-retained-hedgerow-post-intervention.js'
const USAGE = [
  'Usage:',
  `  node ${SCRIPT} <lengthKm> <hedgeType> <condition>`,
  '',
  'Example (matches JSDoc in hedgerow-post-intervention.js):',
  `  node ${SCRIPT} 0.5 "Native hedgerow" Good`,
  '',
  'Hedge type may be quoted or unquoted (words between length and condition are joined):',
  `  node ${SCRIPT} 0.5 Native hedgerow Good`,
  '',
  'Run built-in example with no arguments:',
  `  node ${SCRIPT} --example`
]

const mode = resolveArgvMode(SCRIPT, USAGE)

if (mode === 'example') {
  runCli(() =>
    calculateRetainedHedgerowPostIntervention(0.5, 'Native hedgerow', 'Good')
  )
} else {
  const parsed = parseRetainedPositionalArgs(process.argv.slice(2))
  if (!parsed) {
    exitWithUsage(SCRIPT, USAGE)
  }
  const lengthKm = parsePositiveNumber('lengthKm', parsed.sizeRaw)
  runCli(() =>
    calculateRetainedHedgerowPostIntervention(
      lengthKm,
      parsed.habitat,
      parsed.condition
    )
  )
}
