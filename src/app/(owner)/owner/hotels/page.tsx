/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import OwnerHotelStatusButton from '@/components/owner/OwnerHotelStatusButton'
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
  const [hotels, listingRequests] = await Promise.all([
    prisma.hotel.findMany({
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
    }),
    prisma.hotelListingRequest.findMany({
      where: { ownerId: session.user.id },
      select: { id: true, hotelName: true, city: true, state: true, status: true, reviewReason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">My properties</h1>
          <p className="mt-1 text-sm text-gray-500">View assigned properties and control whether approved listings are available on Waystay.</p>
        </div>
        <Link href="/owner/hotels/new" className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-orange-700">
          <span aria-hidden="true">+</span> List another hotel
        </Link>
      </div>
      <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
        Hotel details, rooms, prices, photos and other website content are managed by Waystay administrators. Contact the admin when information needs to be added or changed.
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {hotels.map(hotel => {
          const decision = hotel.auditLogs[0]
          const approvalStatus = hotel.isApproved ? 'APPROVED' : decision?.action === 'HOTEL_REJECTED' ? 'REJECTED' : 'PENDING'
          const reason = reasonFromMetadata(decision?.metadata)
          const listingStatus = !hotel.isActive ? 'SUSPENDED BY ADMIN' : hotel.ownerEnabled ? 'ENABLED' : 'DISABLED BY YOU'
          return (
            <article key={hotel.id} className="rounded-2xl border border-gray-100 bg-white p-5">
              <div className="flex gap-4">
                {hotel.images[0]
                  ? <img src={hotel.images[0].url} alt="" className="h-24 w-32 rounded-xl object-cover" />
                  : <div className="flex h-24 w-32 items-center justify-center rounded-xl bg-gray-100 text-xs text-gray-400">No photo</div>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div><h2 className="font-semibold text-gray-900">{hotel.name}</h2><p className="text-xs text-gray-500">{hotel.city}, {hotel.state}</p></div>
                    <div className="flex flex-col items-end gap-1"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${approvalStatus === 'APPROVED' ? 'bg-green-50 text-green-700' : approvalStatus === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{approvalStatus}</span>{hotel.isApproved && <span className={`text-[10px] font-bold ${hotel.isActive && hotel.ownerEnabled ? 'text-green-700' : 'text-slate-500'}`}>{listingStatus}</span>}</div>
                  </div>
                  <p className="mt-3 text-xs text-gray-500">{hotel._count.rooms} rooms · {hotel._count.reviews} reviews</p>
                  {hotel.isApproved && hotel.isActive && hotel.ownerEnabled && <Link href={`/hotels/${hotel.id}`} className="mt-3 inline-block text-xs font-semibold text-indigo-600 hover:underline">View public listing</Link>}
                  {hotel.isApproved && <OwnerHotelStatusButton hotelId={hotel.id} hotelName={hotel.name} initialEnabled={hotel.ownerEnabled} adminActive={hotel.isActive} />}
                </div>
              </div>
              {reason && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">Admin feedback: {reason}</p>}
            </article>
          )
        })}
        {hotels.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center xl:col-span-2"><p className="text-sm text-gray-500">No hotels have been assigned to your account yet. Waystay administration will add the property after verification.</p></div>}
      </div>

      {listingRequests.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-gray-900">Additional hotel requests</h2>
          <p className="mt-1 text-sm text-gray-500">Track properties you have submitted for administrator review.</p>
          <div className="mt-4 space-y-3">
            {listingRequests.map(request => (
              <article key={request.id} className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-gray-100 bg-white p-4">
                <div>
                  <h3 className="font-semibold text-gray-900">{request.hotelName}</h3>
                  <p className="mt-1 text-xs text-gray-500">{request.city}, {request.state} · Submitted {request.createdAt.toLocaleDateString('en-IN')}</p>
                  {request.reviewReason && <p className="mt-2 text-sm text-gray-600">Admin note: {request.reviewReason}</p>}
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${request.status === 'REVIEWED' ? 'bg-green-50 text-green-700' : request.status === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{request.status === 'REVIEWED' ? 'REVIEWED BY ADMIN' : request.status}</span>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
