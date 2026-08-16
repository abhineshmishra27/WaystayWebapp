import PartnerApplicationTable from '@/components/admin/PartnerApplicationTable'
import { requireAdminSession } from '@/lib/admin-auth'
import { prisma } from '@/lib/db'

export default async function AdminPartnersPage() {
  await requireAdminSession()
  const applications = await prisma.partnerApplication.findMany({
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
  })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Partner applications</h1>
        <p className="mt-1 text-sm text-gray-500">Review onboarding intent, approve owner access, and contact applicants for complete property information.</p>
      </div>
      <PartnerApplicationTable initialApplications={applications.map(application => ({
        ...application,
        reviewer: application.reviewedBy,
        reviewedBy: undefined,
        createdAt: application.createdAt.toISOString(),
        reviewedAt: application.reviewedAt?.toISOString() ?? null,
      }))} />
    </div>
  )
}
