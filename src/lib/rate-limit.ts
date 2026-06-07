const requestCounts = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, maxRequests: number, windowMs: number): { success: boolean; remaining: number } {
  const now = Date.now()
  const existing = requestCounts.get(key)

  if (!existing || existing.resetAt < now) {
    requestCounts.set(key, { count: 1, resetAt: now + windowMs })
    return { success: true, remaining: maxRequests - 1 }
  }

  if (existing.count >= maxRequests) {
    return { success: false, remaining: 0 }
  }

  existing.count++
  return { success: true, remaining: maxRequests - existing.count }
}
