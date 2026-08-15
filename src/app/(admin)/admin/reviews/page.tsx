import { prisma } from '@/lib/db'
import { requireAdminSession } from '@/lib/admin-auth'
import ReviewModerationList from '@/components/admin/ReviewModerationList'

export default async function AdminReviewsPage() {
  await requireAdminSession()
  const [reviews, published, hidden] = await Promise.all([
    prisma.review.findMany({
      include: {
        customer: { select: { id: true, name: true, email: true } },
        hotel: { select: { id: true, name: true, city: true } },
        media: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.review.count({ where: { status: 'PUBLISHED' } }),
    prisma.review.count({ where: { status: 'HIDDEN' } }),
  ])

  return (
    <div>
      <div className="mb-6"><h1 className="text-2xl font-semibold text-gray-900">Review moderation</h1><p className="mt-1 text-sm text-gray-500">Inspect guest content and hide or republish reviews without deleting evidence.</p></div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3"><div className="rounded-2xl border border-gray-100 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Total reviews</p><p className="mt-2 text-2xl font-semibold text-gray-900">{published + hidden}</p></div><div className="rounded-2xl border border-green-100 bg-green-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-green-600">Published</p><p className="mt-2 text-2xl font-semibold text-green-900">{published}</p></div><div className="rounded-2xl border border-gray-200 bg-gray-100 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hidden</p><p className="mt-2 text-2xl font-semibold text-gray-900">{hidden}</p></div></div>
      <ReviewModerationList initialReviews={reviews.map(review => ({
        id: review.id,
        status: review.status,
        rating: review.rating,
        title: review.title,
        body: review.body,
        ownerReply: review.ownerReply,
        moderationReason: review.moderationReason,
        moderatedAt: review.moderatedAt?.toISOString() ?? null,
        createdAt: review.createdAt.toISOString(),
        customer: review.customer,
        hotel: review.hotel,
        bookingId: review.bookingId,
        media: review.media,
      }))} />
    </div>
  )
}
