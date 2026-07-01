#!/usr/bin/env node

import { calculateCreatedHedgerowPostIntervention } from '../src/hedgerow-post-intervention.js'
import {
  exitWithUsage,
  parseCreationPositionalArgs,
  parseNonNegativeYears,
  parsePositiveNumber,
  resolveArgvMode,
  runCli
} from './post-intervention-cli-shared.js'

const SCRIPT =
  'bng-metric-engine/scripts/calc-created-hedgerow-post-intervention.js'
const USAGE = [
  'Usage:',
  `  node ${SCRIPT} <lengthKm> <hedgeType> <condition> <advanceYears> <delayYears>`,
  '',
  'Example:',
  `  node ${SCRIPT} 1 "Native hedgerow" Moderate 0 0`,
  '',
  'Hedge type may be quoted or unquoted (words between length and condition are joined):',
  `  node ${SCRIPT} 1 Native hedgerow Moderate 0 0`,
  '',
  'Run built-in example with no arguments:',
  `  node ${SCRIPT} --example`
]

const mode = resolveArgvMode(SCRIPT, USAGE)

if (mode === 'example') {
  runCli(() =>
    calculateCreatedHedgerowPostIntervention(
      1,
      'Native hedgerow',
      'Moderate',
      0,
      0
    )
  )
} else {
  const parsed = parseCreationPositionalArgs(process.argv.slice(2))
  if (!parsed) {
    exitWithUsage(SCRIPT, USAGE)
  }
  const lengthKm = parsePositiveNumber('lengthKm', parsed.sizeRaw)
  const advanceYears = parseNonNegativeYears(
    'advanceYears',
    parsed.advanceYears
  )
  const delayYears = parseNonNegativeYears('delayYears', parsed.delayYears)
  runCli(() =>
    calculateCreatedHedgerowPostIntervention(
      lengthKm,
      parsed.habitat,
      parsed.condition,
      advanceYears,
      delayYears
    )
  )
}
