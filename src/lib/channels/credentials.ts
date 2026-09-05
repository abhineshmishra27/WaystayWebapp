import 'server-only'

import type { ChannelConnection } from '@prisma/client'
import { prisma } from '@/lib/db'
import { decryptSecret, encryptSecret } from '@/lib/crypto'
import { CloudbedsAdapter } from '@/lib/channels/cloudbeds'
import { ChannelAuthError, type ChannelAdapter, type ChannelCredentials } from '@/lib/channels/types'

/**
 * Adapter construction and token lifecycle.
 *
 * Access tokens last 8 hours, so refreshing is routine rather than exceptional. Two
 * things make it safe: the refresh is serialised per connection with a Postgres
 * advisory lock so concurrent requests cannot each burn a refresh token, and the
 * re-read inside that lock means the loser of a race adopts the winner's new token
 * instead of refreshing again.
 */

export function channelsAreEnabled() {
  return process.env.CHANNELS_ENABLED !== 'false'
}

export function adapterForProvider(provider: ChannelConnection['provider']): ChannelAdapter {
  switch (provider) {
    case 'CLOUDBEDS': {
      const clientId = process.env.CLOUDBEDS_CLIENT_ID
      const clientSecret = process.env.CLOUDBEDS_CLIENT_SECRET
      if (!clientId || !clientSecret) {
        throw new Error('CLOUDBEDS_CLIENT_ID and CLOUDBEDS_CLIENT_SECRET must be configured')
      }
      return new CloudbedsAdapter(clientId, clientSecret)
    }
    default: {
      // Exhaustiveness: adding a provider to the enum without an adapter fails to compile.
      const unreachable: never = provider
      throw new Error(`No adapter registered for channel provider ${String(unreachable)}`)
    }
  }
}

/** Advisory lock key space kept distinct from booking's `waystay-room:` locks. */
function refreshLockKey(connectionId: string) {
  return `waystay-channel-refresh:${connectionId}`
}

function credentialsFrom(connection: ChannelConnection): ChannelCredentials {
  return {
    accessToken: decryptSecret(connection.accessTokenEnc),
    refreshToken: decryptSecret(connection.refreshTokenEnc),
    expiresAt: connection.tokenExpiresAt,
  }
}

function isExpired(expiresAt: Date) {
  return expiresAt.getTime() <= Date.now()
}

/**
 * Usable credentials for a connection, refreshing first if the access token has
 * expired. Callers should treat the result as valid for the duration of one operation
 * and call `withFreshCredentials` for anything longer-running.
 */
export async function getUsableCredentials(connectionId: string): Promise<{
  connection: ChannelConnection
  credentials: ChannelCredentials
}> {
  const connection = await prisma.channelConnection.findUniqueOrThrow({ where: { id: connectionId } })
  if (!isExpired(connection.tokenExpiresAt)) {
    return { connection, credentials: credentialsFrom(connection) }
  }
  return refreshCredentials(connection)
}

export async function refreshCredentials(connection: ChannelConnection) {
  const adapter = adapterForProvider(connection.provider)

  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${refreshLockKey(connection.id)}))::text AS lock_result`

    // Re-read under the lock: a concurrent caller may have already refreshed, and
    // reusing a spent refresh token would revoke the connection at the provider.
    const current = await tx.channelConnection.findUniqueOrThrow({ where: { id: connection.id } })
    if (!isExpired(current.tokenExpiresAt)) {
      return { connection: current, credentials: credentialsFrom(current) }
    }

    let tokens
    try {
      tokens = await adapter.refreshCredentials(decryptSecret(current.refreshTokenEnc))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Token refresh failed'
      await tx.channelConnection.update({
        where: { id: current.id },
        // syncEnabled is deliberately untouched: the operator's intent to sync is
        // separate from a transient credential problem, so reconnecting recovers
        // without anyone having to remember to switch it back on.
        data: { status: 'ERROR', lastSyncError: `Token refresh failed: ${message}` },
      })
      throw new ChannelAuthError(`Could not refresh credentials for connection ${current.id}`, { cause: error })
    }

    const updated = await tx.channelConnection.update({
      where: { id: current.id },
      data: {
        accessTokenEnc: encryptSecret(tokens.accessToken),
        refreshTokenEnc: encryptSecret(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
        status: current.status === 'ERROR' ? 'ACTIVE' : current.status,
        lastSyncError: null,
      },
    })

    return { connection: updated, credentials: credentialsFrom(updated) }
  })
}

/**
 * Runs an operation with valid credentials, retrying once if the provider rejects the
 * token mid-flight. A token can expire between our check and the provider's, and one
 * forced refresh is cheaper than failing a sync that was otherwise fine.
 */
export async function withFreshCredentials<T>(
  connectionId: string,
  operation: (credentials: ChannelCredentials, connection: ChannelConnection) => Promise<T>,
): Promise<T> {
  const { connection, credentials } = await getUsableCredentials(connectionId)

  try {
    return await operation(credentials, connection)
  } catch (error) {
    if (!(error instanceof ChannelAuthError)) throw error

    // Force a refresh even though we believed the token was live, then retry once.
    const refreshed = await refreshCredentials({
      ...connection,
      tokenExpiresAt: new Date(0),
    })
    return operation(refreshed.credentials, refreshed.connection)
  }
}
