import 'server-only'

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

type RateLimitRow = { count: number; resetAt: Date }

export async function rateLimit(key: string, maxRequests: number, windowMs: number) {
  const safeMaximum = Math.max(1, Math.min(10_000, Math.floor(maxRequests)))
  const safeWindowMs = Math.max(1_000, Math.min(24 * 60 * 60 * 1000, Math.floor(windowMs)))
  const keyHash = createHash('sha256').update(key).digest('hex')
  const nextResetAt = new Date(Date.now() + safeWindowMs)

  const rows = await prisma.$queryRaw<RateLimitRow[]>(Prisma.sql`
    INSERT INTO "RateLimitBucket" AS bucket ("keyHash", "count", "resetAt", "updatedAt")
    VALUES (${keyHash}, 1, ${nextResetAt}, CURRENT_TIMESTAMP)
    ON CONFLICT ("keyHash") DO UPDATE SET
      "count" = CASE
        WHEN bucket."resetAt" <= CURRENT_TIMESTAMP THEN 1
        ELSE bucket."count" + 1
      END,
      "resetAt" = CASE
        WHEN bucket."resetAt" <= CURRENT_TIMESTAMP THEN EXCLUDED."resetAt"
        ELSE bucket."resetAt"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "count", "resetAt"
  `)

  const bucket = rows[0]
  if (!bucket) throw new Error('Rate limit state could not be recorded')

  return {
    success: bucket.count <= safeMaximum,
    remaining: Math.max(0, safeMaximum - bucket.count),
    resetAt: bucket.resetAt,
  }
}
