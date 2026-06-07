interface ReviewMediaType { id: string; url: string }
interface ReviewCustomerType { name: string; avatarUrl?: string | null }
interface ReviewType {
  id: string
  rating: number
  title: string
  body: string
  ownerReply?: string | null
  createdAt: string
  customer: ReviewCustomerType
  media: ReviewMediaType[]
}

export default function ReviewList({ reviews, avgRating }: { reviews: ReviewType[]; avgRating: number }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">
        Reviews · <span className="text-yellow-500">{'★'.repeat(Math.round(avgRating))}</span> {avgRating.toFixed(1)}
      </h2>
      <div className="space-y-4">
        {reviews.map((r: ReviewType) => (
          <div key={r.id} className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-medium">
                {r.customer.name[0]}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800">{r.customer.name}</p>
                <p className="text-xs text-gray-400">{'★'.repeat(r.rating)} · {new Date(r.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}</p>
              </div>
            </div>
            <p className="font-medium text-gray-800 mb-1">{r.title}</p>
            <p className="text-gray-600 text-sm">{r.body}</p>
            {r.media.length > 0 && (
              <div className="flex gap-2 mt-3">
                {r.media.map((m: ReviewMediaType) => (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img key={m.id} src={m.url} alt="Review media" className="w-16 h-16 object-cover rounded-lg" />
                  </>
                ))}
              </div>
            )}
            {r.ownerReply && (
              <div className="mt-3 bg-gray-50 rounded-lg p-3 text-sm">
                <p className="font-medium text-gray-700 mb-1">Owner response:</p>
                <p className="text-gray-600">{r.ownerReply}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
