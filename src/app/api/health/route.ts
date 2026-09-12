import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * Liveness plus a real database round trip.
 *
 * Twice a long-running server reached a state where every query failed while the
 * database itself was healthy, and answering "is it the app or the database?" took a
 * sequence of manual experiments. This endpoint answers it in one request, and gives an
 * uptime check something better than the homepage to poll.
 *
 * Deliberately unauthenticated but says nothing sensitive: no connection string, no
 * host, no error text - only whether the round trip worked and how long it took.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()

  try {
    await prisma.$queryRaw`SELECT 1`
    const latencyMs = Date.now() - startedAt

    // Slow but working is the interesting signal - it usually means the serverless
    // database was suspended and is waking up.
    if (latencyMs > 2000) {
      logger.warn('health.database.slow', undefined, { latencyMs })
    }

    return NextResponse.json(
      { status: 'ok', database: 'ok', latencyMs, uptimeSeconds: Math.round(process.uptime()) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    const latencyMs = Date.now() - startedAt
    // The detail goes to the logs, never to the response.
    logger.error('health.database.unreachable', error, { latencyMs })

    return NextResponse.json(
      { status: 'degraded', database: 'unreachable', latencyMs, uptimeSeconds: Math.round(process.uptime()) },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
