import { config } from '../../config.js'
import { createLogger } from './logging/logger.js'

/**
 * Hapi's `load` options: the memory backstop. Deliberately separate from the
 * parse budget: that one counts the bytes it hands out and so can only see
 * files being parsed, while this reads the process's actual RSS — which is
 * what the OOM-killer reads too, and what measurement showed climbing to
 * 1.2 GB from workers and retained heap while the parse budget sat
 * unexhausted. Off by default (0), because the right ceiling depends on the
 * task memory limit, which each environment sets in its app config. A
 * deployed environment that leaves it off logs a warning at boot, so the
 * missing setting does not go unnoticed.
 * @returns {{ maxRssBytes?: number, sampleInterval?: number }}
 */
export function loadOptions() {
  const maxRssBytes = config.get('validation.maxRssBytes')
  if (maxRssBytes) {
    return {
      maxRssBytes,
      sampleInterval: config.get('validation.loadSampleIntervalMs')
    }
  }

  if (config.get('cdpEnvironment') !== 'local') {
    createLogger().warn(
      'VALIDATION_MAX_RSS_BYTES is not set: under memory pressure the task will be killed at its memory limit instead of refusing new requests with a 503'
    )
  }
  return {}
}
