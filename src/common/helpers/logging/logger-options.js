import { ecsFormat } from '@elastic/ecs-pino-format'
import { config } from '../../../config.js'
import { getTraceId } from '@defra/hapi-tracing'
import { getCorrelationId } from '../correlation-id.js'

const logConfig = config.get('log')
const serviceName = config.get('serviceName')
const serviceVersion = config.get('serviceVersion')

function hasTraceBinding(logger) {
  return Boolean(logger?.bindings?.()?.trace?.id)
}

function hasSessionBinding(logger) {
  return Boolean(logger?.bindings?.()?.session?.id)
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
  ...formatters[logConfig.format],
  nesting: true,
  mixin(_mergeObject, _level, logger) {
    const mixinValues = {}
    const traceId = getTraceId()
    const sessionId = getCorrelationId()

    if (!hasTraceBinding(logger) && traceId) {
      mixinValues.trace = { id: traceId }
    }

    if (!hasSessionBinding(logger) && sessionId) {
      mixinValues.session = { id: sessionId }
    }

    return mixinValues
  }
}
