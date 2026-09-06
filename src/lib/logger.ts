/**
 * Structured logging.
 *
 * The app logged with bare `console.error` where it logged at all, and 18 catch blocks
 * discarded the exception without binding it. Two production incidents were diagnosed
 * by elimination rather than by reading an error, because there was no error to read.
 *
 * One line of JSON per event, on stdout/stderr: Vercel, Docker and journald all capture
 * that as-is, and it stays greppable locally. No dependency and no transport, so this
 * cannot itself become a source of failures. If an error-tracking service is added
 * later, `emit` is the single place that forwards to it.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = Record<string, unknown>

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function configuredLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase()
  if (configured === 'debug' || configured === 'info' || configured === 'warn' || configured === 'error') {
    return configured
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

/**
 * Errors do not survive JSON.stringify - it yields `{}`. Unwrap the useful parts, and
 * follow `cause` so a wrapped provider error keeps the original reason attached.
 */
export function serializeError(error: unknown, depth = 0): unknown {
  if (error === null || error === undefined) return null

  if (error instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
    }
    if (error.stack) serialized.stack = error.stack
    // Carry provider-specific fields such as ChannelApiError.status/retryable.
    for (const key of Object.keys(error) as Array<keyof typeof error>) {
      if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue
      serialized[key as string] = (error as unknown as Record<string, unknown>)[key as string]
    }
    // Bounded, because a cause chain can be circular.
    if (error.cause !== undefined && depth < 4) {
      serialized.cause = serializeError(error.cause, depth + 1)
    }
    return serialized
  }

  if (typeof error === 'object') {
    try {
      return JSON.parse(JSON.stringify(error))
    } catch {
      return { unserializable: String(error) }
    }
  }

  return { value: String(error) }
}

export function formatLogLine(
  level: LogLevel,
  event: string,
  context?: LogContext,
  error?: unknown,
): string {
  const payload: Record<string, unknown> = {
    level,
    event,
    time: new Date().toISOString(),
    ...(context ?? {}),
  }
  if (error !== undefined) payload.error = serializeError(error)

  try {
    return JSON.stringify(payload)
  } catch {
    // Never let logging throw: a circular value in context must not take down a request.
    return JSON.stringify({ level, event, time: payload.time, contextUnserializable: true })
  }
}

function emit(level: LogLevel, event: string, context?: LogContext, error?: unknown) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return

  const line = formatLogLine(level, event, context, error)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

/**
 * `warn` and `error` share an argument order on purpose. They previously mirrored each
 * other - (event, context, error) against (event, error, context) - which reads fine at
 * the definition and is a trap at the call site: passing the two the wrong way round is
 * silent, and the error ends up logged as context with its message stripped.
 */
export const logger = {
  debug: (event: string, context?: LogContext) => emit('debug', event, context),
  info: (event: string, context?: LogContext) => emit('info', event, context),
  warn: (event: string, error?: unknown, context?: LogContext) => emit('warn', event, context, error),
  error: (event: string, error?: unknown, context?: LogContext) => emit('error', event, context, error),
}
