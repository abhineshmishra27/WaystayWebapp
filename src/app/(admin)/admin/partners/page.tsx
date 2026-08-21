import HotelListingRequestTable from '@/components/admin/HotelListingRequestTable'
import PartnerApplicationTable from '@/components/admin/PartnerApplicationTable'
import { requireAdminSession } from '@/lib/admin-auth'
import { prisma } from '@/lib/db'

export default async function AdminPartnersPage() {
  await requireAdminSession()
  const [applications, hotelRequests] = await Promise.all([
    prisma.partnerApplication.findMany({
      select: {
        id: true,
        fullName: true,
        businessName: true,
        email: true,
        phone: true,
        gstNumber: true,
        city: true,
        state: true,
        propertyCount: true,
        message: true,
        status: true,
        reviewReason: true,
        reviewedAt: true,
        reviewedBy: { select: { name: true, email: true } },
        createdAt: true,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.hotelListingRequest.findMany({
      select: {
        id: true,
        hotelName: true,
        gstNumber: true,
        licenseNumber: true,
        address: true,
        city: true,
        state: true,
        pincode: true,
        contactPhone: true,
        roomCount: true,
        message: true,
        status: true,
        reviewReason: true,
        reviewedAt: true,
        reviewedBy: { select: { name: true, email: true } },
        owner: { select: { id: true, name: true, email: true } },
        createdAt: true,
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
  ])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Partner onboarding</h1>
        <p className="mt-1 text-sm text-gray-500">Review new owner applications and additional hotel requests from approved owners.</p>
      </div>
      <section>
        <h2 className="text-lg font-semibold text-gray-900">Additional hotel requests</h2>
        <p className="mb-4 mt-1 text-sm text-gray-500">Requests submitted by owners who already have portal access.</p>
        <HotelListingRequestTable initialRequests={hotelRequests.map(request => ({
          ...request,
          reviewer: request.reviewedBy,
          reviewedBy: undefined,
          createdAt: request.createdAt.toISOString(),
          reviewedAt: request.reviewedAt?.toISOString() ?? null,
        }))} />
      </section>

      <section className="mt-10 border-t border-gray-200 pt-8">
        <h2 className="text-lg font-semibold text-gray-900">New owner applications</h2>
        <p className="mb-4 mt-1 text-sm text-gray-500">Approve owner access before an applicant can use the owner portal.</p>
        <PartnerApplicationTable initialApplications={applications.map(application => ({
          ...application,
          reviewer: application.reviewedBy,
          reviewedBy: undefined,
          createdAt: application.createdAt.toISOString(),
          reviewedAt: application.reviewedAt?.toISOString() ?? null,
        }))} />
      </section>
    </div>
  )
}
