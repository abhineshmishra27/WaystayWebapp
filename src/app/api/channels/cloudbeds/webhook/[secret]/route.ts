import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { secretsMatch } from '@/lib/crypto'
import { adapterForProvider, channelsAreEnabled } from '@/lib/channels/credentials'
import { recordSyncLog, syncAvailabilityWindow } from '@/lib/channels/sync'

/**
 * Receives Cloudbeds webhooks.
 *
 * Three documented facts drive this design, and none of them are comfortable:
 *
 *   1. There is **no signature**. Nothing in the request proves Cloudbeds sent it, so
 *      the payload cannot be trusted as fact. Authentication is therefore an
 *      unguessable secret in the path - the only thing a caller must know.
 *   2. Delivery order is **not guaranteed**. An older event can arrive after a newer
 *      one, so applying payload contents in arrival order would corrupt state.
 *   3. Delivery is retried five times, so the same event arrives repeatedly.
 *
 * The response is: treat the payload purely as a hint that something changed, never as
 * the new state. On any relevant event we re-read the authoritative calendar from the
 * API and apply that. Convergence rather than sequencing makes out-of-order delivery
 * harmless, makes replays idempotent, and means a forged payload can at worst cause an
 * unnecessary re-read of real data - it can never write attacker-chosen values.
 */

export const dynamic = 'force-dynamic'

function unauthorized() {
  // Deliberately identical to the not-configured case: a prober should not be able to
  // tell whether the secret exists or is merely wrong.
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params
  const expected = process.env.CLOUDBEDS_WEBHOOK_PATH_SECRET
  if (!expected || !secretsMatch(secret, expected)) return unauthorized()

  const payload = await request.json().catch(() => null)
  if (!payload) {
    // 400 rather than a retryable status: a body we cannot parse will not parse on the
    // fifth attempt either.
    return NextResponse.json({ error: 'Unreadable payload' }, { status: 400 })
  }

  const event = adapterForProvider('CLOUDBEDS').parseWebhookEvent(payload)
  if (!event) {
    logger.warn('api.channels.cloudbeds.webhook.unrecognised', undefined, { payloadKeys: Object.keys(payload) })
    // Acknowledged on purpose: retrying an event we will never understand wastes five
    // more deliveries and buries the ones that matter.
    return NextResponse.json({ accepted: false, reason: 'unrecognised event' })
  }

  // The unique index on eventKey is what makes redelivery a no-op. Claiming the key
  // before doing any work means a retry arriving while the first is still running is
  // rejected here rather than duplicating the work.
  try {
    await prisma.channelSyncLog.create({
      data: {
        kind: 'WEBHOOK',
        outcome: 'SUCCESS',
        eventKey: event.eventKey,
        message: `Received ${event.kind}`,
        payload: { externalPropertyId: event.externalPropertyId, externalReservationId: event.externalReservationId },
      },
    })
  } catch {
    logger.info('api.channels.cloudbeds.webhook.duplicate', { eventKey: event.eventKey })
    return NextResponse.json({ accepted: true, duplicate: true })
  }

  if (!channelsAreEnabled()) {
    return NextResponse.json({ accepted: true, skipped: 'channels disabled' })
  }

  const connection = event.externalPropertyId
    ? await prisma.channelConnection.findUnique({
        where: {
          provider_externalPropertyId: { provider: 'CLOUDBEDS', externalPropertyId: event.externalPropertyId },
        },
        select: { id: true, syncEnabled: true, status: true },
      })
    : null

  if (!connection) {
    logger.warn('api.channels.cloudbeds.webhook.unknown_property', undefined, {
      externalPropertyId: event.externalPropertyId,
    })
    return NextResponse.json({ accepted: true, skipped: 'unknown property' })
  }
  if (!connection.syncEnabled || connection.status === 'DISCONNECTED') {
    return NextResponse.json({ accepted: true, skipped: 'sync disabled for this connection' })
  }

  const needsResync = event.kind === 'RESERVATION_CHANGED' || event.kind === 'AVAILABILITY_CHANGED'
  if (!needsResync) {
    return NextResponse.json({ accepted: true, skipped: `no action for ${event.kind}` })
  }

  // Acknowledge first, reconcile after. Cloudbeds counts a slow response as a failure
  // and retries, so doing the re-read inline would turn one event into five.
  after(async () => {
    try {
      const outcome = await syncAvailabilityWindow(connection.id)
      logger.info('api.channels.cloudbeds.webhook.resynced', {
        connectionId: connection.id,
        eventKey: event.eventKey,
        holdsWritten: outcome.holdsWritten,
      })
    } catch (error) {
      // The reconciliation cron will retry this connection regardless, so a failure
      // here degrades to "slightly stale" rather than "lost".
      logger.error('api.channels.cloudbeds.webhook.resync_failed', error, { connectionId: connection.id })
      await recordSyncLog({
        connectionId: connection.id,
        kind: 'WEBHOOK',
        outcome: 'FAILED',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  })

  return NextResponse.json({ accepted: true, connectionId: connection.id })
}
