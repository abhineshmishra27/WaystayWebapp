import Image from 'next/image'
import Link from 'next/link'
import SearchBar from '@/components/hotels/SearchBar'

const POPULAR_CITIES = [
  {
    name: 'Mumbai',
    image: 'https://images.unsplash.com/photo-1570168007204-dfb528c6958f?auto=format&fit=crop&w=900&q=80',
    alt: 'Gateway of India and Mumbai waterfront',
  },
  {
    name: 'Delhi',
    image: 'https://images.unsplash.com/photo-1587474260584-136574528ed5?auto=format&fit=crop&w=900&q=80',
    alt: 'India Gate in Delhi',
  },
  {
    name: 'Bangalore',
    image: 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2?auto=format&fit=crop&w=900&q=80',
    alt: 'Bangalore city skyline',
  },
  {
    name: 'Chennai',
    image: '/city-chennai.png',
    alt: 'Marina Beach and its red-and-white lighthouse in Chennai',
  },
  {
    name: 'Pune',
    image: '/city-pune.png',
    alt: 'Historic Shaniwar Wada fort entrance in Pune',
  },
  {
    name: 'Hyderabad',
    image: '/city-hyderabad.png',
    alt: 'Charminar illuminated at blue hour in Hyderabad',
  },
]

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 text-white py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Find your perfect stay</h1>
          <p className="text-indigo-200 text-lg mb-10">Book by the hour — 3hrs, 6hrs, 12hrs or full day</p>
          <SearchBar />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="text-2xl font-semibold text-gray-900 mb-8">Popular destinations</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {POPULAR_CITIES.map(city => (
            <Link
              key={city.name}
              href={`/hotels?city=${encodeURIComponent(city.name)}`}
              className="group relative rounded-2xl overflow-hidden aspect-[4/3] cursor-pointer"
            >
              <Image
                src={city.image}
                alt={city.alt}
                fill
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                style={{ objectFit: 'cover' }}
                className="group-hover:scale-105 transition-transform duration-300"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <span className="absolute bottom-4 left-4 text-white font-semibold text-lg">{city.name}</span>
            </Link>
          ))}
        </div>

        <section className="mt-14" aria-labelledby="introductory-offer-heading">
          <h2 id="introductory-offer-heading" className="text-2xl font-semibold text-gray-900 mb-8">
            Special offer
          </h2>
          <Link
            href="/hotels"
            className="group relative block overflow-hidden rounded-3xl bg-cyan-100 shadow-xl shadow-cyan-900/10 ring-1 ring-black/5"
          >
            <div className="relative aspect-[16/9] sm:aspect-[2/1] lg:aspect-[16/7]">
              <Image
                src="/introductory-offer-beach.png"
                alt="10% introductory offer displayed on a swing beside a colorful tropical beach"
                fill
                sizes="(min-width: 1152px) 1152px, 100vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.02]"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-slate-950/60 via-slate-900/10 to-transparent" />
              <div className="absolute inset-y-0 left-0 flex w-[45%] items-center p-5 sm:p-8 lg:p-12">
                <div className="text-white drop-shadow-md">
                  <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-300 sm:text-sm">
                    A warm welcome
                  </p>
                  <p className="max-w-xs text-lg font-semibold leading-tight sm:text-2xl lg:text-3xl">
                    Your first getaway just got sweeter
                  </p>
                  <span className="mt-4 inline-flex rounded-full bg-white px-4 py-2 text-xs font-bold text-indigo-700 shadow-md transition-transform group-hover:translate-x-1 sm:text-sm">
                    Explore stays →
                  </span>
                </div>
              </div>
            </div>
          </Link>
        </section>
      </div>
    </div>
  )
}
