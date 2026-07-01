#!/usr/bin/env node

import { calculateEnhancedWatercoursePostIntervention } from '../src/watercourse-post-intervention.js'
import {
  exitWithUsage,
  parseNonNegativeYears,
  parsePositiveNumber,
  resolveArgvMode,
  runCli
} from './post-intervention-cli-shared.js'
import { parseWatercourseEnhancementPositionalArgs } from './post-intervention-watercourse-cli-shared.js'

const SCRIPT =
  'bng-metric-engine/scripts/calc-enhanced-watercourse-post-intervention.js'
const USAGE = [
  'Usage:',
  `  node ${SCRIPT} <baselineLengthKm> [postInterventionLengthKm] <baselineWatercourseType> -- <postInterventionWatercourseType> <baselineCondition> <postInterventionCondition> [watercourseEncroachment] [riparianEncroachment] <advanceYears> <delayYears>`,
  '',
  'Example (different watercourse types, same baseline and post-intervention length):',
  `  node ${SCRIPT} 1 1 Ditches -- "Priority habitat" Moderate Good "No Encroachment" "No Encroachment/No Encroachment" 0 0`,
  '',
  'Example (different watercourse types and post-intervention length longer than baseline):',
  `  node ${SCRIPT} 1 2 Ditches -- "Priority habitat" Moderate Good "No Encroachment" "No Encroachment/No Encroachment" 0 0`,
  '',
  'When postInterventionLengthKm is omitted it defaults to baselineLengthKm:',
  `  node ${SCRIPT} 1 Ditches -- "Priority habitat" Moderate Good 0 0`,
  '',
  'Example (same watercourse type, different lengths):',
  `  node ${SCRIPT} 1 2 "Priority habitat" Moderate Good 0 0`,
  '',
  'When baseline and post-intervention share the same watercourse type, omit "--":',
  `  node ${SCRIPT} 1 "Priority habitat" Poor Moderate Minor "Minor/No Encroachment" 0 0`,
  '',
  'Use "-" to omit optional encroachment values (defaults to multiplier 1):',
  `  node ${SCRIPT} 1 Priority habitat Poor Moderate Minor - 0 0`,
  '',
  'Run built-in example with no arguments:',
  `  node ${SCRIPT} --example`
]

const mode = resolveArgvMode(SCRIPT, USAGE)

if (mode === 'example') {
  runCli(() =>
    calculateEnhancedWatercoursePostIntervention(
      1,
      1,
      'Ditches',
      'Priority habitat',
      'Moderate',
      'Good',
      {
        watercourseEncroachment: 'No Encroachment',
        riparianEncroachment: 'No Encroachment/No Encroachment',
        advanceYears: 0,
        delayYears: 0
      }
    )
  )
} else {
  const parsed = parseWatercourseEnhancementPositionalArgs(
    process.argv.slice(2)
  )
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
    calculateEnhancedWatercoursePostIntervention(
      baselineLengthKm,
      postInterventionLengthKm,
      parsed.baselineWatercourseType,
      parsed.postInterventionWatercourseType,
      parsed.baselineCondition,
      parsed.postInterventionCondition,
      {
        watercourseEncroachment: parsed.watercourseEncroachment,
        riparianEncroachment: parsed.riparianEncroachment,
        advanceYears,
        delayYears
      }
    )
  )
}
