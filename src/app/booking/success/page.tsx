import Link from 'next/link'

export default async function BookingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  const bookingId = Array.isArray(query.bookingId) ? query.bookingId[0] : query.bookingId
  const paymentMethod = Array.isArray(query.paymentMethod) ? query.paymentMethod[0] : query.paymentMethod

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-gray-100 p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-green-600 text-2xl">✓</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Booking confirmed!</h1>
        <p className="text-gray-500 mb-4">
          {paymentMethod === 'pay-at-hotel'
            ? 'No online payment was collected. You can pay directly at the hotel.'
            : 'A confirmation email has been sent to you.'}
        </p>
        {bookingId && (
          <p className="text-sm text-gray-400 mb-6">Booking ID: <span className="font-mono text-gray-600">{bookingId}</span></p>
        )}
        <div className="flex gap-3">
          <Link href="/dashboard/bookings" className="flex-1 bg-indigo-600 text-white py-3 rounded-xl text-sm font-medium hover:bg-indigo-700 text-center">
            View my bookings
          </Link>
          <Link href="/hotels" className="flex-1 border border-gray-200 text-gray-700 py-3 rounded-xl text-sm font-medium hover:bg-gray-50 text-center">
            Browse more hotels
          </Link>
        </div>
      </div>
    </div>
  )
}
