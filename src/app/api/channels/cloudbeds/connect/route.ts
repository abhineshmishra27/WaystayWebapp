import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { requireApiPermission } from '@/lib/api-rbac'
import { getEffectiveRole, hasPermission, PERMISSIONS } from '@/lib/rbac'
import { logger } from '@/lib/logger'
import { cloudbedsAuthorizeUrl } from '@/lib/channels/cloudbeds'
import { channelsAreEnabled } from '@/lib/channels/credentials'
import { createOAuthState } from '@/lib/channels/oauth-state'

/**
 * Starts the Cloudbeds OAuth round trip.
 *
 * Admin-only, and the admin nominates which OWNER user the imported hotels will belong
 * to - every Hotel needs a non-null ownerId, and reusing the existing owner model means
 * an imported hotel behaves like any other in that owner's dashboard.
 *
 * The owner id travels inside the signed state rather than as a query parameter, so it
 * cannot be swapped on the way back.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.CHANNEL_MANAGE)
  if (permissionError) return permissionError

  if (!channelsAreEnabled()) {
    return NextResponse.json({ error: 'Channel integrations are disabled.' }, { status: 503 })
  }

  const clientId = process.env.CLOUDBEDS_CLIENT_ID
  const redirectUri = process.env.CLOUDBEDS_REDIRECT_URI
  if (!clientId || !redirectUri || !process.env.CHANNEL_CREDENTIALS_KEY) {
    // Configuration, not a user error: say so plainly rather than failing at the provider.
    return NextResponse.json(
      { error: 'Cloudbeds is not configured. CLOUDBEDS_CLIENT_ID, CLOUDBEDS_REDIRECT_URI and CHANNEL_CREDENTIALS_KEY are required.' },
      { status: 503 },
    )
  }

  const ownerId = request.nextUrl.searchParams.get('ownerId')?.trim()
  if (!ownerId) {
    return NextResponse.json({ error: 'Choose which owner the imported hotels belong to.' }, { status: 400 })
  }

  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, email: true, role: true, isActive: true },
  })
  if (!owner || !owner.isActive || !hasPermission(getEffectiveRole(owner.email, owner.role), PERMISSIONS.OWNER_ACCESS)) {
    return NextResponse.json({ error: 'Choose an active owner account.' }, { status: 400 })
  }

  const state = createOAuthState({ adminId: session!.user.id, ownerId: owner.id })
  logger.info('api.channels.cloudbeds.connect.started', { adminId: session!.user.id, ownerId: owner.id })

  return NextResponse.redirect(cloudbedsAuthorizeUrl({ clientId, redirectUri, state }))
}
