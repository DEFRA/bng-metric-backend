#!/usr/bin/env node

import { calculateRetainedAreaHabitatPostIntervention } from '../src/post-intervention.js'
import {
  exitWithUsage,
  parsePositiveNumber,
  parseRetainedPositionalArgs,
  resolveArgvMode,
  runCli
} from './post-intervention-cli-shared.js'

const SCRIPT =
  'bng-metric-engine/scripts/calc-retained-area-habitat-post-intervention.js'
const USAGE = [
  'Usage:',
  `  node ${SCRIPT} <sizeHa> <habitat> <condition>`,
  '',
  'Example (matches JSDoc in post-intervention.js):',
  `  node ${SCRIPT} 100 "Grassland - Modified grassland" Moderate`,
  '',
  'Habitat may be quoted or unquoted (words between size and condition are joined):',
  `  node ${SCRIPT} 100 Grassland - Modified grassland Moderate`,
  '',
  'Run built-in example with no arguments:',
  `  node ${SCRIPT} --example`
]

const mode = resolveArgvMode(SCRIPT, USAGE)

if (mode === 'example') {
  runCli(() =>
    calculateRetainedAreaHabitatPostIntervention(
      100,
      'Grassland - Modified grassland',
      'Moderate'
    )
  )
} else {
  const parsed = parseRetainedPositionalArgs(process.argv.slice(2))
  if (!parsed) {
    exitWithUsage(SCRIPT, USAGE)
  }
  const size = parsePositiveNumber('sizeHa', parsed.sizeRaw)
  runCli(() =>
    calculateRetainedAreaHabitatPostIntervention(
      size,
      parsed.habitat,
      parsed.condition
    )
  )
}
