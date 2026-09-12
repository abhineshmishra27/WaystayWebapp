'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast, { Toaster } from 'react-hot-toast'

type ConnectionStatus = 'PENDING' | 'ACTIVE' | 'ERROR' | 'DISCONNECTED'

export interface ChannelConnectionRow {
  id: string
  provider: string
  externalPropertyId: string
  propertyName: string | null
  status: ConnectionStatus
  currency: string
  propertyTimezone: string
  syncEnabled: boolean
  lastSyncedAt: string | null
  lastSyncError: string | null
  consecutiveFailures: number
  owner: { id: string; name: string; email: string }
  hotels: Array<{ id: string; name: string; isApproved: boolean }>
  _count: { roomMappings: number }
}

export interface ChannelSyncLogRow {
  id: string
  connectionId: string | null
  kind: string
  outcome: string
  message: string | null
  createdAt: string
}

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  ACTIVE: 'bg-green-50 text-green-700',
  PENDING: 'bg-amber-50 text-amber-700',
  ERROR: 'bg-red-50 text-red-700',
  DISCONNECTED: 'bg-gray-100 text-gray-500',
}

const OUTCOME_STYLES: Record<string, string> = {
  SUCCESS: 'text-green-700',
  PARTIAL: 'text-amber-700',
  FAILED: 'text-red-700',
}

function formatWhen(value: string | null) {
  if (!value) return 'never'
  return new Date(value).toLocaleString()
}

export default function ChannelConnectionTable({
  connections,
  recentLogs,
  owners,
  cloudbedsConfigured,
}: {
  connections: ChannelConnectionRow[]
  recentLogs: ChannelSyncLogRow[]
  owners: Array<{ id: string; name: string; email: string }>
  cloudbedsConfigured: boolean
}) {
  const router = useRouter()
  const [ownerId, setOwnerId] = useState(owners[0]?.id ?? '')
  const [busyId, setBusyId] = useState<string | null>(null)

  async function act(connection: ChannelConnectionRow, action: 'resync' | 'disconnect') {
    if (action === 'disconnect') {
      const confirmed = window.confirm(
        `Stop syncing ${connection.propertyName || connection.externalPropertyId}?\n\n` +
          'Imported hotels and their bookings are kept. Availability stops being refreshed, ' +
          'and channel holds are released so rooms are not withheld on stale information.',
      )
      if (!confirmed) return
    }

    setBusyId(connection.id)
    try {
      const response = await fetch(`/api/admin/channels/${connection.id}/${action}`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Could not ${action}`)

      toast.success(
        action === 'resync'
          ? `Imported ${data.roomsUpserted} room type(s), ${data.availability?.slotsCreated ?? 0} slot(s)`
          : `Disconnected. ${data.hotelsRetained} hotel(s) kept, ${data.holdsReleased} hold(s) released.`,
      )
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not ${action}`)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <Toaster position="top-right" />

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="font-semibold text-gray-900">Connect a property</h2>
        {cloudbedsConfigured ? (
          owners.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">
              No active owner accounts exist yet. Imported hotels need an owner, so approve a
              partner application first.
            </p>
          ) : (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-gray-400">Imported hotels belong to</span>
                <select
                  value={ownerId}
                  onChange={event => setOwnerId(event.target.value)}
                  className="mt-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800"
                >
                  {owners.map(owner => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name} ({owner.email})
                    </option>
                  ))}
                </select>
              </label>
              {/* A plain link, not fetch: this is the start of an OAuth redirect chain. */}
              <a
                href={`/api/channels/cloudbeds/connect?ownerId=${encodeURIComponent(ownerId)}`}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                Connect Cloudbeds
              </a>
            </div>
          )
        ) : (
          <p className="mt-3 text-sm text-gray-500">
            Cloudbeds is not configured. Set <code>CLOUDBEDS_CLIENT_ID</code>,{' '}
            <code>CLOUDBEDS_REDIRECT_URI</code> and <code>CHANNEL_CREDENTIALS_KEY</code> to enable
            connecting.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="font-semibold text-gray-900">Connections</h2>
        {connections.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">No properties connected yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {connections.map(connection => (
              <article key={connection.id} className="rounded-xl border border-gray-100 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      {connection.propertyName || connection.externalPropertyId}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[connection.status]}`}>
                        {connection.status}
                      </span>
                      {!connection.syncEnabled && connection.status !== 'DISCONNECTED' && (
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          sync paused
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      {connection.provider} · {connection.externalPropertyId} · {connection.currency} ·{' '}
                      {connection.propertyTimezone}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Owner: {connection.owner.name} · {connection._count.roomMappings} room type(s) mapped ·
                      last synced {formatWhen(connection.lastSyncedAt)}
                    </p>
                    {connection.hotels.length > 0 && (
                      <p className="mt-1 text-xs text-gray-500">
                        {connection.hotels
                          .map(hotel => `${hotel.name}${hotel.isApproved ? '' : ' (awaiting approval)'}`)
                          .join(', ')}
                      </p>
                    )}
                    {connection.lastSyncError && (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                        {connection.lastSyncError}
                        {connection.consecutiveFailures > 1 && ` (${connection.consecutiveFailures} consecutive failures)`}
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => act(connection, 'resync')}
                      disabled={busyId === connection.id || connection.status === 'DISCONNECTED'}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyId === connection.id ? 'Working…' : connection.hotels.length > 0 ? 'Re-sync' : 'Import'}
                    </button>
                    <button
                      type="button"
                      onClick={() => act(connection, 'disconnect')}
                      disabled={busyId === connection.id || connection.status === 'DISCONNECTED'}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <h2 className="font-semibold text-gray-900">Recent sync activity</h2>
        <p className="mt-1 text-xs text-gray-400">
          Every sync operation is recorded here, including failures that retried successfully.
        </p>
        {recentLogs.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {recentLogs.map(log => (
              <li key={log.id} className="flex flex-wrap gap-2 border-b border-gray-50 pb-2 text-xs last:border-0">
                <span className="text-gray-400">{formatWhen(log.createdAt)}</span>
                <span className="font-medium text-gray-700">{log.kind}</span>
                <span className={OUTCOME_STYLES[log.outcome] ?? 'text-gray-600'}>{log.outcome}</span>
                {log.message && <span className="text-gray-600">{log.message}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
