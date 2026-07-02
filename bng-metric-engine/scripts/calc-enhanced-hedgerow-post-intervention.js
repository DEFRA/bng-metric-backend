#!/usr/bin/env node

import { calculateEnhancedHedgerowPostIntervention } from '../src/hedgerow-post-intervention.js'
import {
  exitWithUsage,
  parseHedgerowEnhancementPositionalArgs,
  parseNonNegativeYears,
  parsePositiveNumber,
  resolveArgvMode,
  runCli
} from './post-intervention-cli-shared.js'

const SCRIPT =
  'bng-metric-engine/scripts/calc-enhanced-hedgerow-post-intervention.js'
const USAGE = [
  'Usage:',
  `  node ${SCRIPT} <baselineLengthKm> [postInterventionLengthKm] <baselineHedgeType> -- <postInterventionHedgeType> <baselineCondition> <postInterventionCondition> <advanceYears> <delayYears>`,
  '',
  'Example (different baseline and post-intervention hedge types):',
  `  node ${SCRIPT} 1 1 "Native hedgerow" -- "Species-rich native hedgerow" Moderate Good 0 0`,
  '',
  'When postInterventionLengthKm is omitted it defaults to baselineLengthKm:',
  `  node ${SCRIPT} 1 Native hedgerow Poor Moderate 0 0`,
  '',
  'Hedge types may be quoted or unquoted (words between delimiters are joined):',
  `  node ${SCRIPT} 1 Native hedgerow -- Species-rich native hedgerow Moderate Good 0 0`,
  '',
  'When baseline and post-intervention share the same hedge type, omit "--":',
  `  node ${SCRIPT} 1 Native hedgerow Poor Moderate 0 0`,
  '',
  'Run built-in example with no arguments:',
  `  node ${SCRIPT} --example`
]

const mode = resolveArgvMode(SCRIPT, USAGE)

if (mode === 'example') {
  runCli(() =>
    calculateEnhancedHedgerowPostIntervention(
      1,
      1,
      'Native hedgerow',
      'Species-rich native hedgerow',
      'Moderate',
      'Good',
      { advanceYears: 0, delayYears: 0 }
    )
  )
} else {
  const parsed = parseHedgerowEnhancementPositionalArgs(process.argv.slice(2))
  if (!parsed) {
    exitWithUsage(SCRIPT, USAGE)
  }
  const baselineLengthKm = parsePositiveNumber(
    'baselineLengthKm',
    parsed.baselineLengthRaw
  )
  const postInterventionLengthKm = parsePositiveNumber(
    'postInterventionLengthKm',
    parsed.postInterventionLengthRaw
  )
  const advanceYears = parseNonNegativeYears(
    'advanceYears',
    parsed.advanceYears
  )
  const delayYears = parseNonNegativeYears('delayYears', parsed.delayYears)
  runCli(() =>
    calculateEnhancedHedgerowPostIntervention(
      baselineLengthKm,
      postInterventionLengthKm,
      parsed.baselineHedgeType,
      parsed.postInterventionHedgeType,
      parsed.baselineCondition,
      parsed.postInterventionCondition,
      { advanceYears, delayYears }
    )
  )
}
