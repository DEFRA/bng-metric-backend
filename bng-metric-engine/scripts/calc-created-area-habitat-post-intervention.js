#!/usr/bin/env node

import { calculateCreatedAreaHabitatPostIntervention } from '../src/post-intervention.js'
import {
  exitWithUsage,
  parseCreationPositionalArgs,
  parseNonNegativeYears,
  parsePositiveNumber,
  resolveArgvMode,
  runCli
} from './post-intervention-cli-shared.js'

const SCRIPT =
  'bng-metric-engine/scripts/calc-created-area-habitat-post-intervention.js'
const USAGE = [
  'Usage:',
  `  node ${SCRIPT} <sizeHa> <habitat> <condition> <advanceYears> <delayYears>`,
  '',
  'Example:',
  `  node ${SCRIPT} 1 "Grassland - Modified grassland" Moderate 0 0`,
  '',
  'Habitat may be quoted or unquoted (words between size and condition are joined):',
  `  node ${SCRIPT} 10 Grassland - Modified grassland Moderate 5 0`,
  '',
  'Run built-in example with no arguments:',
  `  node ${SCRIPT} --example`
]

const mode = resolveArgvMode(SCRIPT, USAGE)

if (mode === 'example') {
  runCli(() =>
    calculateCreatedAreaHabitatPostIntervention(
      1,
      'Grassland - Modified grassland',
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
  const size = parsePositiveNumber('sizeHa', parsed.sizeRaw)
  const advanceYears = parseNonNegativeYears(
    'advanceYears',
    parsed.advanceYears
  )
  const delayYears = parseNonNegativeYears('delayYears', parsed.delayYears)
  runCli(() =>
    calculateCreatedAreaHabitatPostIntervention(
      size,
      parsed.habitat,
      parsed.condition,
      advanceYears,
      delayYears
    )
  )
}
