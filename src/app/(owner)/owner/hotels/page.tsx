/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { PERMISSIONS, sessionHasPermission } from '@/lib/rbac'

function reasonFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const reason = (metadata as Record<string, unknown>).reason
  return typeof reason === 'string' && reason.trim() ? reason : null
}

export default async function OwnerHotelsPage() {
  const session = await auth()
  if (!session || !sessionHasPermission(session, PERMISSIONS.OWNER_ACCESS)) redirect('/login?error=unauthorized')
  const hotels = await prisma.hotel.findMany({
    where: { ownerId: session.user.id },
    include: {
      images: { orderBy: { sortOrder: 'asc' }, take: 1 },
      _count: { select: { rooms: true, reviews: true } },
      auditLogs: {
        where: { action: { in: ['HOTEL_APPROVED', 'HOTEL_REJECTED'] } },
        select: { action: true, metadata: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div><div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold text-gray-900">My properties</h1><p className="mt-1 text-sm text-gray-500">Track hotel submissions and their approval status.</p></div><Link href="/owner/hotels/new" className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Add hotel</Link></div><div className="mt-6 grid gap-4 xl:grid-cols-2">{hotels.map(hotel => { const decision = hotel.auditLogs[0]; const status = hotel.isApproved ? 'APPROVED' : decision?.action === 'HOTEL_REJECTED' ? 'REJECTED' : 'PENDING'; const reason = reasonFromMetadata(decision?.metadata); return <article key={hotel.id} className="rounded-2xl border border-gray-100 bg-white p-5"><div className="flex gap-4">{hotel.images[0] ? <img src={hotel.images[0].url} alt="" className="h-24 w-32 rounded-xl object-cover" /> : <div className="flex h-24 w-32 items-center justify-center rounded-xl bg-gray-100 text-xs text-gray-400">No photo</div>}<div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold text-gray-900">{hotel.name}</h2><p className="text-xs text-gray-500">{hotel.city}, {hotel.state}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status === 'APPROVED' ? 'bg-green-50 text-green-700' : status === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{status}</span></div><p className="mt-3 text-xs text-gray-500">{hotel._count.rooms} rooms · {hotel._count.reviews} reviews · Submitted {hotel.createdAt.toLocaleDateString('en-IN')}</p>{hotel.isApproved && <Link href={`/hotels/${hotel.id}`} className="mt-3 inline-block text-xs font-semibold text-indigo-600 hover:underline">View public listing</Link>}</div></div>{reason && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">Admin feedback: {reason}</p>}</article>})}{hotels.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center xl:col-span-2"><p className="text-sm text-gray-500">No properties submitted yet.</p><Link href="/owner/hotels/new" className="mt-3 inline-block text-sm font-semibold text-indigo-600 hover:underline">Start hotel onboarding</Link></div>}</div></div>
  )
}
