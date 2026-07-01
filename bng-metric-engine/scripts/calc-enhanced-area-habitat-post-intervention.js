#!/usr/bin/env node

import { calculateEnhancedAreaHabitatPostIntervention } from '../src/post-intervention.js'
import {
  exitWithUsage,
  parseAreaHabitatEnhancementPositionalArgs,
  parseNonNegativeYears,
  parsePositiveNumber,
  resolveArgvMode,
  runCli
} from './post-intervention-cli-shared.js'

const SCRIPT =
  'bng-metric-engine/scripts/calc-enhanced-area-habitat-post-intervention.js'
const USAGE = [
  'Usage:',
  `  node ${SCRIPT} <sizeHa> <baselineHabitat> -- <postInterventionHabitat> <baselineCondition> <postInterventionCondition> <advanceYears> <delayYears>`,
  '',
  'Example (different baseline and post-intervention habitats):',
  `  node ${SCRIPT} 1 "Grassland - Modified grassland" -- "Heathland and shrub - Lowland heathland" Lower Moderate 0 0`,
  '',
  'Habitats may be quoted or unquoted (words between delimiters are joined):',
  `  node ${SCRIPT} 1 Grassland - Modified grassland -- Heathland and shrub - Lowland heathland Lower Moderate 0 0`,
  '',
  'When baseline and post-intervention share the same habitat type, omit "--":',
  `  node ${SCRIPT} 1 Grassland - Modified grassland Lower Moderate 0 0`,
  '',
  'Run built-in example with no arguments:',
  `  node ${SCRIPT} --example`
]

const mode = resolveArgvMode(SCRIPT, USAGE)

if (mode === 'example') {
  runCli(() =>
    calculateEnhancedAreaHabitatPostIntervention(
      1,
      'Grassland - Modified grassland',
      'Heathland and shrub - Lowland heathland',
      'Lower',
      'Moderate',
      0,
      0
    )
  )
} else {
  const parsed = parseAreaHabitatEnhancementPositionalArgs(
    process.argv.slice(2)
  )
  if (!parsed) {
    exitWithUsage(SCRIPT, USAGE)
  }
  const size = parsePositiveNumber('sizeHa', parsed.sizeRaw)
  const advanceYears = parseNonNegativeYears(
    'advanceYears',
    parsed.advanceYears
  )
  const delayYears = parseNonNegativeYears('delayYears', parsed.delayYears)
  runCli(() =>
    calculateEnhancedAreaHabitatPostIntervention(
      size,
      parsed.baselineHabitat,
      parsed.postInterventionHabitat,
      parsed.baselineCondition,
      parsed.postInterventionCondition,
      advanceYears,
      delayYears
    )
  )
}
