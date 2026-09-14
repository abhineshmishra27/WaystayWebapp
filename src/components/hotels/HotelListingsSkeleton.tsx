export default function HotelListingsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="ws-listing-card">
          <div className="aspect-[16/10] animate-pulse bg-[#f3eee7]" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-[#f3eee7]" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-[#f3eee7]" />
            <div className="mt-3 h-3 w-1/4 animate-pulse rounded bg-[#f3eee7]" />
          </div>
        </div>
      ))}
    </div>
  )
}
