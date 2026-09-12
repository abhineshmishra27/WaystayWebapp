import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { requireApiPermission } from '@/lib/api-rbac'
import { PERMISSIONS } from '@/lib/rbac'
import { logger } from '@/lib/logger'
import { encryptSecret } from '@/lib/crypto'
import { adapterForProvider } from '@/lib/channels/credentials'
import { recordSyncLog } from '@/lib/channels/sync'
import { verifyOAuthState } from '@/lib/channels/oauth-state'

/**
 * Completes the Cloudbeds OAuth round trip.
 *
 * Creates a connection per property the account exposes, all left un-imported: the
 * admin picks which to bring in from /admin/channels. Doing it this way avoids a
 * property-picker screen for what is usually a single property, and an unwanted
 * connection is one disconnect away.
 *
 * Nothing here trusts the query string. The state proves this server started the round
 * trip and carries the owner the admin chose; the session is re-checked because a
 * redirect is an unauthenticated entry point as far as the app is concerned.
 */

export const dynamic = 'force-dynamic'

function backToAdmin(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/admin/channels', request.nextUrl.origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.CHANNEL_MANAGE)
  if (permissionError) return permissionError

  const providerError = request.nextUrl.searchParams.get('error')
  if (providerError) {
    logger.warn('api.channels.cloudbeds.callback.denied', undefined, { providerError })
    return backToAdmin(request, { connected: 'denied' })
  }

  let payload
  try {
    payload = verifyOAuthState(request.nextUrl.searchParams.get('state'))
  } catch (error) {
    logger.error('api.channels.cloudbeds.callback.invalid_state', error)
    return backToAdmin(request, { connected: 'invalid_state' })
  }

  // The state names the admin who started this; a different admin finishing it would
  // mean the redirect was delivered to the wrong session.
  if (payload.adminId !== session!.user.id) {
    logger.error('api.channels.cloudbeds.callback.admin_mismatch', undefined, {
      startedBy: payload.adminId,
      finishedBy: session!.user.id,
    })
    return backToAdmin(request, { connected: 'invalid_state' })
  }

  const code = request.nextUrl.searchParams.get('code')
  const redirectUri = process.env.CLOUDBEDS_REDIRECT_URI
  if (!code || !redirectUri) {
    return backToAdmin(request, { connected: 'missing_code' })
  }

  try {
    const adapter = adapterForProvider('CLOUDBEDS')
    const tokens = await adapter.exchangeAuthorizationCode(code, redirectUri)
    const properties = await adapter.listProperties(tokens)

    if (properties.length === 0) {
      await recordSyncLog({
        connectionId: null,
        kind: 'IMPORT',
        outcome: 'FAILED',
        message: 'Cloudbeds account exposed no properties to connect',
      })
      return backToAdmin(request, { connected: 'no_properties' })
    }

    // Tokens are account-wide, so every property shares this grant. Re-connecting an
    // already-known property refreshes its tokens rather than duplicating it.
    for (const property of properties) {
      await prisma.channelConnection.upsert({
        where: {
          provider_externalPropertyId: {
            provider: 'CLOUDBEDS',
            externalPropertyId: property.externalPropertyId,
          },
        },
        create: {
          provider: 'CLOUDBEDS',
          externalPropertyId: property.externalPropertyId,
          propertyName: property.name,
          ownerId: payload.ownerId,
          status: 'PENDING',
          currency: property.currency || 'INR',
          propertyTimezone: property.timezone || 'Asia/Kolkata',
          accessTokenEnc: encryptSecret(tokens.accessToken),
          refreshTokenEnc: encryptSecret(tokens.refreshToken),
          tokenExpiresAt: tokens.expiresAt,
          scopes: tokens.scopes,
        },
        update: {
          propertyName: property.name,
          accessTokenEnc: encryptSecret(tokens.accessToken),
          refreshTokenEnc: encryptSecret(tokens.refreshToken),
          tokenExpiresAt: tokens.expiresAt,
          scopes: tokens.scopes,
          // Reconnecting is how an operator recovers a connection that errored.
          status: 'PENDING',
          lastSyncError: null,
          consecutiveFailures: 0,
        },
      })
    }

    await recordSyncLog({
      connectionId: null,
      kind: 'IMPORT',
      outcome: 'SUCCESS',
      message: `Connected ${properties.length} Cloudbeds propert${properties.length === 1 ? 'y' : 'ies'}`,
    })
    logger.info('api.channels.cloudbeds.callback.connected', {
      propertyCount: properties.length,
      ownerId: payload.ownerId,
    })

    return backToAdmin(request, { connected: 'ok', properties: String(properties.length) })
  } catch (error) {
    logger.error('api.channels.cloudbeds.callback.failed', error)
    await recordSyncLog({
      connectionId: null,
      kind: 'IMPORT',
      outcome: 'FAILED',
      message: error instanceof Error ? error.message : String(error),
    })
    return backToAdmin(request, { connected: 'failed' })
  }
}
