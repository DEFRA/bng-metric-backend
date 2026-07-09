import { ecsFormat } from '@elastic/ecs-pino-format'
import { config } from '../../../config.js'
import { getTraceId } from '@defra/hapi-tracing'
import { getCorrelationId } from '../correlation-id.js'
import { sessionCorrelationIdSymbol } from '../session-correlation-id-symbol.js'

const logConfig = config.get('log')
const serviceName = config.get('serviceName')
const serviceVersion = config.get('serviceVersion')
const sessionPrefixPattern = /^\[session\.id=[^\]]+\]\s/

function hasTraceBinding(logger) {
  return Boolean(logger?.bindings?.()?.trace?.id)
}

export function prefixMessageWithSessionId(args, sessionId) {
  if (!sessionId) {
    return args
  }

  const prefixedArgs = [...args]
  const messageIndex = prefixedArgs.findIndex((arg) => typeof arg === 'string')
  const prefix = `[session.id=${sessionId}]`

  if (messageIndex === -1) {
    prefixedArgs.push(prefix)
    return prefixedArgs
  }

  if (!sessionPrefixPattern.test(prefixedArgs[messageIndex])) {
    prefixedArgs[messageIndex] = `${prefix} ${prefixedArgs[messageIndex]}`
  }

  return prefixedArgs
}

function withSessionMessagePrefix(formatterOptions = {}) {
  const logMethod = formatterOptions.hooks?.logMethod

  return {
    ...formatterOptions,
    hooks: {
      ...formatterOptions.hooks,
      logMethod(args, method, level) {
        const prefixedArgs = prefixMessageWithSessionId(
          args,
          getCorrelationId() ?? this?.[sessionCorrelationIdSymbol]
        )

        // CDP log ingestion retains message text, but may drop non-allowlisted
        // structured fields such as session.id. Keep the session id searchable in
        // OpenSearch by prefixing the message instead of relying on a custom field.
        if (logMethod) {
          return logMethod.call(this, prefixedArgs, method, level)
        }

        return method.apply(this, prefixedArgs)
      }
    }
  }
}

const formatters = {
  ecs: {
    ...ecsFormat({
      serviceVersion,
      serviceName
    })
  },
  'pino-pretty': { transport: { target: 'pino-pretty' } }
}

export const loggerOptions = {
  enabled: logConfig.isEnabled,
  ignorePaths: ['/health'],
  redact: {
    paths: logConfig.redact,
    remove: true
  },
  level: logConfig.level,
  ...withSessionMessagePrefix(formatters[logConfig.format]),
  nesting: true,
  mixin(_mergeObject, _level, logger) {
    const traceId = getTraceId()

    if (!hasTraceBinding(logger) && traceId) {
      return { trace: { id: traceId } }
    }

    return {}
  }
}
