#!/usr/bin/env node

/**
 * Shared helpers for post-intervention CLI scripts.
 */

/**
 * @param {string} name
 * @param {string | undefined} raw
 * @returns {number}
 */
export function parsePositiveNumber(name, raw) {
  if (raw === undefined || raw === '') {
    throw new TypeError(`Missing ${name}`)
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number, got: ${raw}`)
  }
  return value
}

/**
 * @param {string} name
 * @param {string | undefined} raw
 * @returns {number}
 */
export function parseNonNegativeYears(name, raw) {
  if (raw === undefined || raw === '') {
    throw new TypeError(`Missing ${name}`)
  }
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(
      `${name} must be a non-negative finite number, got: ${raw}`
    )
  }
  return value
}

/**
 * @param {object} result
 */
export function printResult(result) {
  console.log(JSON.stringify(result, null, 2))
}

/**
 * @param {string} scriptLabel
 * @param {string[]} lines
 * @returns {never}
 */
export function exitWithUsage(scriptLabel, lines) {
  console.error(`${scriptLabel}\n`)
  for (const line of lines) {
    console.error(line)
  }
  process.exit(1)
}

/**
 * @param {() => object} run
 */
export function runCli(run) {
  try {
    printResult(run())
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

/**
 * @param {string} scriptPath
 * @param {string[]} usageLines
 * @returns {'help' | 'example' | 'run'}
 */
export function resolveArgvMode(scriptPath, usageLines) {
  const first = process.argv[2]

  if (first === '--help' || first === '-h') {
    exitWithUsage(scriptPath, usageLines)
  }

  if (first === undefined || first === '--example') {
    if (first === undefined) {
      console.error('No arguments provided; running built-in example.\n')
    }
    return 'example'
  }

  return 'run'
}

/**
 * Positional args after flags: size, habitat (may contain spaces), condition.
 * @param {string[]} args
 * @returns {{ sizeRaw: string, habitat: string, condition: string } | null}
 */
export function parseRetainedPositionalArgs(args) {
  if (args.length < 3) {
    return null
  }
  const condition = args.at(-1)
  const sizeRaw = args[0]
  const habitat = args.slice(1, -1).join(' ').trim()
  if (!habitat || !condition) {
    return null
  }
  return { sizeRaw, habitat, condition }
}

/**
 * Positional args: size, habitat, condition, advanceYears, delayYears.
 * @param {string[]} args
 * @returns {{ sizeRaw: string, habitat: string, condition: string, advanceYears: string, delayYears: string } | null}
 */
export function parseCreationPositionalArgs(args) {
  if (args.length < 5) {
    return null
  }
  const delayYears = args.at(-1)
  const advanceYears = args.at(-2)
  const condition = args.at(-3)
  const sizeRaw = args[0]
  const habitat = args.slice(1, -3).join(' ').trim()
  if (!habitat || !condition || !advanceYears || !delayYears) {
    return null
  }
  return { sizeRaw, habitat, condition, advanceYears, delayYears }
}

/**
 * Positional args: size, habitat, startCondition, endCondition, advanceYears, delayYears.
 * @param {string[]} args
 * @returns {{ sizeRaw: string, habitat: string, startCondition: string, endCondition: string, advanceYears: string, delayYears: string } | null}
 */
export function parseEnhancementPositionalArgs(args) {
  if (args.length < 6) {
    return null
  }
  const delayYears = args.at(-1)
  const advanceYears = args.at(-2)
  const endCondition = args.at(-3)
  const startCondition = args.at(-4)
  const sizeRaw = args[0]
  const habitat = args.slice(1, -4).join(' ').trim()
  if (
    !habitat ||
    !startCondition ||
    !endCondition ||
    !advanceYears ||
    !delayYears
  ) {
    return null
  }
  return {
    sizeRaw,
    habitat,
    startCondition,
    endCondition,
    advanceYears,
    delayYears
  }
}

/**
 * Positional args: size, baselineHabitat, [--,] postInterventionHabitat,
 * baselineCondition, postInterventionCondition, advanceYears, delayYears.
 * Use "--" between baseline and post-intervention habitat when they differ
 * (each may be multiple words). When "--" is omitted, one habitat span applies
 * to both baseline and post-intervention.
 * @param {string[]} args
 * @returns {{ sizeRaw: string, baselineHabitat: string, postInterventionHabitat: string, baselineCondition: string, postInterventionCondition: string, advanceYears: string, delayYears: string } | null}
 */
export function parseAreaHabitatEnhancementPositionalArgs(args) {
  const separatorIndex = args.indexOf('--')

  if (separatorIndex !== -1) {
    const before = args.slice(0, separatorIndex)
    const after = args.slice(separatorIndex + 1)

    if (before.length < 2 || after.length < 4) {
      return null
    }

    const sizeRaw = before[0]
    const baselineHabitat = before.slice(1).join(' ').trim()
    const delayYears = after.at(-1)
    const advanceYears = after.at(-2)
    const postInterventionCondition = after.at(-3)
    const baselineCondition = after.at(-4)
    const postInterventionHabitat = after.slice(0, -4).join(' ').trim()

    if (
      !baselineHabitat ||
      !postInterventionHabitat ||
      !baselineCondition ||
      !postInterventionCondition ||
      !advanceYears ||
      !delayYears
    ) {
      return null
    }

    return {
      sizeRaw,
      baselineHabitat,
      postInterventionHabitat,
      baselineCondition,
      postInterventionCondition,
      advanceYears,
      delayYears
    }
  }

  const legacy = parseEnhancementPositionalArgs(args)
  if (!legacy) {
    return null
  }

  return {
    sizeRaw: legacy.sizeRaw,
    baselineHabitat: legacy.habitat,
    postInterventionHabitat: legacy.habitat,
    baselineCondition: legacy.startCondition,
    postInterventionCondition: legacy.endCondition,
    advanceYears: legacy.advanceYears,
    delayYears: legacy.delayYears
  }
}

/**
 * Positional args: baselineLengthKm, [postInterventionLengthKm], baselineHedgeType,
 * [--,] postInterventionHedgeType, baselineCondition, postInterventionCondition,
 * advanceYears, delayYears.
 * @param {string[]} args
 * @returns {{ baselineLengthRaw: string, postInterventionLengthRaw: string, baselineHedgeType: string, postInterventionHedgeType: string, baselineCondition: string, postInterventionCondition: string, advanceYears: string, delayYears: string } | null}
 */
export function parseHedgerowEnhancementPositionalArgs(args) {
  const peeled = peelWatercourseEnhancementLengths(args)
  if (!peeled) {
    return null
  }

  const parsed = parseAreaHabitatEnhancementPositionalArgs(peeled.remainder)
  if (!parsed) {
    return null
  }

  return {
    baselineLengthRaw: peeled.baselineLengthRaw,
    postInterventionLengthRaw: peeled.postInterventionLengthRaw,
    baselineHedgeType: parsed.baselineHabitat,
    postInterventionHedgeType: parsed.postInterventionHabitat,
    baselineCondition: parsed.baselineCondition,
    postInterventionCondition: parsed.postInterventionCondition,
    advanceYears: parsed.advanceYears,
    delayYears: parsed.delayYears
  }
}

/**
 * @param {string | undefined} raw
 * @returns {string | null}
 */
export function parseOptionalEncroachmentArg(raw) {
  if (raw === undefined || raw === '' || raw === '-') {
    return null
  }
  return raw
}

// Watercourse-specific parsers live in post-intervention-watercourse-cli-shared.js.

// ---------------------------------------------------------------------------
// Shared helpers for enhancement-length argument parsing (used by both
// hedgerow and watercourse enhancement parsers).
// ---------------------------------------------------------------------------

/**
 * @param {string | undefined} raw
 * @returns {boolean}
 */
function isPositiveNumericArg(raw) {
  if (raw === undefined || raw === '') {
    return false
  }
  const value = Number(raw)
  return Number.isFinite(value) && value > 0
}

/**
 * Peel the leading one or two positive-number arguments (baselineLength and
 * optional postInterventionLength) from an enhancement argument list.
 * Used by hedgerow and watercourse enhancement parsers.
 *
 * @param {string[]} args
 * @returns {{ baselineLengthRaw: string, postInterventionLengthRaw: string, remainder: string[] } | null}
 */
export function peelWatercourseEnhancementLengths(args) {
  if (args.length < 1) {
    return null
  }

  const baselineLengthRaw = args[0]
  let cursor = 1
  let postInterventionLengthRaw = baselineLengthRaw

  if (cursor < args.length && isPositiveNumericArg(args[cursor])) {
    postInterventionLengthRaw = args[cursor]
    cursor += 1
  }

  return {
    baselineLengthRaw,
    postInterventionLengthRaw,
    remainder: args.slice(cursor)
  }
}
