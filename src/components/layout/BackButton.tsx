'use client'

import { usePathname, useRouter } from 'next/navigation'

export default function BackButton() {
  const router = useRouter()
  const pathname = usePathname()

  if (pathname === '/') return null

  function goBack() {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push('/')
    }
  }

  return (
    <div className="border-b border-slate-100 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-2">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-50 hover:text-[var(--waystay-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--waystay-orange)] focus:ring-offset-1"
          aria-label="Go back"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none">
            <path d="M12.5 4.5 7 10l5.5 5.5M7.5 10H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Back</span>
        </button>
      </div>
    </div>
  )
}
