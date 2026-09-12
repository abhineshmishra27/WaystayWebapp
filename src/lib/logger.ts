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

export const REDACTED = '[redacted]'

/**
 * Keys whose values never belong in a log line.
 *
 * This is not hypothetical tidiness. `serializeError` copies every enumerable property
 * off an error, and a Prisma error carries `meta` describing the failed query - which
 * for a booking failure means the guest's email and phone number. Channel connections
 * carry encrypted OAuth tokens on the row itself. Once logs are shipped anywhere
 * external, anything matched here would have gone with them.
 *
 * Keys are split on camelCase and separators before matching, so `guestEmail`,
 * `guest_email` and `email` all match on the word `email` while `slotPattern` does not
 * match on `otp` - which plain substring matching would have got wrong.
 */
const SENSITIVE_WORDS = new Set([
  'password',
  'passwordhash',
  'secret',
  'token',
  'authorization',
  'cookie',
  'credential',
  'credentials',
  'email',
  'phone',
  'mobile',
  'otp',
  'cvv',
  'card',
  'key',
])

/** Matched against the whole key, for names that do not split into useful words. */
const SENSITIVE_KEY_PATTERNS = [/apikey/, /gst_?number/, /licen[sc]e_?number/, /tokenenc$/]

/** Low false-positive: an address in free text is an address, not a stack frame. */
const EMAIL_IN_TEXT = /[\w.+-]+@[\w-]+\.[\w.-]+/g

export function isSensitiveKey(key: string) {
  const lowered = key.toLowerCase()
  if (SENSITIVE_KEY_PATTERNS.some(pattern => pattern.test(lowered))) return true

  return key
    // Split camelCase and PascalCase, then on any non-alphanumeric separator.
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .some(word => SENSITIVE_WORDS.has(word.toLowerCase()))
}

/**
 * Replaces sensitive values in place. Depth-bounded and cycle-safe, because this runs on
 * whatever a caller happened to pass and must never be the thing that throws.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return value.replace(EMAIL_IN_TEXT, REDACTED)
  if (value === null || typeof value !== 'object' || depth > 6) return value

  if (seen.has(value)) return '[circular]'
  seen.add(value)

  if (Array.isArray(value)) return value.map(entry => redact(entry, depth + 1, seen))

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redact(entry, depth + 1, seen)
  }
  return result
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
  // Redaction runs over the whole payload rather than at each call site: a call site
  // that forgets is exactly how a token reaches a log file, and there are dozens.
  const payload: Record<string, unknown> = {
    level,
    event,
    time: new Date().toISOString(),
    ...((redact(context ?? {}) as LogContext) ?? {}),
  }
  if (error !== undefined) payload.error = redact(serializeError(error))

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
