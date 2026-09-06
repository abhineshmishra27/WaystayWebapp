import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { channelsAreEnabled } from '@/lib/channels/credentials'
import { detectOvercommitment, recordSyncLog, retryDuePushes, syncAvailabilityWindow } from '@/lib/channels/sync'
import { dateWindow } from '@/lib/channels/mapping'

/**
 * Periodic reconciliation for every connected property.
 *
 * Webhooks are the fast path and cannot be the only path: Cloudbeds gives up after five
 * delivery attempts, so a property that was briefly unreachable would otherwise drift
 * silently until somebody noticed rooms selling that should not. This sweep is the
 * backstop that makes a missed webhook self-correcting rather than permanent.
 *
 * Each connection is isolated. One property with expired credentials must not stop the
 * others from syncing - the failure is recorded against that connection and the sweep
 * continues.
 */

export const dynamic = 'force-dynamic'

/** Bounded so a large estate spreads across runs rather than timing out mid-sweep. */
const MAX_CONNECTIONS_PER_RUN = 25
const AVAILABILITY_DAYS = 120

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!channelsAreEnabled()) {
    // Not an error: the operator switched this off deliberately.
    return NextResponse.json({ skipped: true, reason: 'CHANNELS_ENABLED=false' })
  }

  const startedAt = Date.now()

  const connections = await prisma.channelConnection.findMany({
    where: {
      status: 'ACTIVE',
      syncEnabled: true,
      // Nothing to reconcile until an import has mapped some rooms.
      roomMappings: { some: {} },
    },
    select: { id: true, propertyName: true, externalPropertyId: true },
    // Least recently synced first, so a failing connection cannot starve the others of
    // attention on every run.
    orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
    take: MAX_CONNECTIONS_PER_RUN,
  })

  const results: Array<{
    connectionId: string
    ok: boolean
    slotsCreated?: number
    holdsWritten?: number
    overcommitted?: number
    error?: string
  }> = []

  for (const connection of connections) {
    try {
      const outcome = await syncAvailabilityWindow(connection.id, { days: AVAILABILITY_DAYS })

      // Only meaningful once holds reflect the provider's current view, so it runs after.
      const overcommitted = await detectOvercommitment(
        connection.id,
        dateWindow(new Date().toISOString().slice(0, 10), AVAILABILITY_DAYS),
      )

      if (overcommitted.length > 0) {
        // PARTIAL, not FAILED: the sync worked. What it revealed is that more rooms are
        // committed than exist, which needs a human, not a retry.
        await recordSyncLog({
          connectionId: connection.id,
          kind: 'AVAILABILITY',
          outcome: 'PARTIAL',
          message:
            `${overcommitted.length} room-date(s) are committed beyond capacity. ` +
            `First: room ${overcommitted[0].roomId} on ${overcommitted[0].date} ` +
            `(${overcommitted[0].bookedUnits} booked + ${overcommitted[0].heldUnits} held > ${overcommitted[0].inventoryCount}).`,
          payload: { overcommitted: overcommitted.slice(0, 20) },
        })
        logger.error('cron.sync_channels.overcommitted', undefined, {
          connectionId: connection.id,
          count: overcommitted.length,
        })
      }

      results.push({
        connectionId: connection.id,
        ok: true,
        slotsCreated: outcome.slotsCreated,
        holdsWritten: outcome.holdsWritten,
        overcommitted: overcommitted.length,
      })
    } catch (error) {
      // syncAvailabilityWindow already marked the connection and wrote its own log entry.
      logger.error('cron.sync_channels.connection_failed', error, { connectionId: connection.id })
      results.push({
        connectionId: connection.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Retries run whatever happened above: a push waiting on a transient provider outage
  // is independent of whether any particular property synced this time round.
  const pushRetries = await retryDuePushes()
  if (pushRetries.stillFailing > 0) {
    logger.warn('cron.sync_channels.pushes_still_failing', undefined, pushRetries)
  }

  const failed = results.filter(result => !result.ok).length
  const summary = {
    pushRetries,
    connectionsConsidered: connections.length,
    succeeded: results.length - failed,
    failed,
    overcommittedConnections: results.filter(result => (result.overcommitted ?? 0) > 0).length,
    more: connections.length === MAX_CONNECTIONS_PER_RUN,
    durationMs: Date.now() - startedAt,
  }

  logger.info('cron.sync_channels.completed', summary)
  return NextResponse.json({ ...summary, results })
}
