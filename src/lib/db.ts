import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Prefer the managed replacement database when it is attached. Runtime traffic
// should use the pooled URL; unpooled/direct URLs are reserved as fallbacks.
const connectionString = (
  process.env.WAYSTAY_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.WAYSTAY_DATABASE_URL_UNPOOLED ??
  process.env.DIRECT_URL ??
  ''
).replace(/(^\"|\"$)/g, '')

function positiveIntFromEnv(name: string, fallback: number) {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      // The database is serverless and suspends its compute when idle, which silently
      // kills pooled sockets. Without recycling, a long-running server can hand a dead
      // connection to every subsequent query and fail indefinitely until restarted.
      // These bounds make the pool discard connections before they can go stale.
      max: positiveIntFromEnv('DATABASE_POOL_MAX', 10),
      idleTimeoutMillis: positiveIntFromEnv('DATABASE_POOL_IDLE_TIMEOUT_MS', 30_000),
      maxLifetimeSeconds: positiveIntFromEnv('DATABASE_POOL_MAX_LIFETIME_SECONDS', 1_800),
      // Fail fast on an unreachable database instead of hanging a request thread.
      connectionTimeoutMillis: positiveIntFromEnv('DATABASE_CONNECTION_TIMEOUT_MS', 10_000),
      keepAlive: true,
    }),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
