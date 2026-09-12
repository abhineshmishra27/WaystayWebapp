'use client'
import { SessionProvider } from 'next-auth/react'
import React, { useEffect } from 'react'
import { DhabaRouteResultsProvider } from '@/components/dhabas/DhabaRouteResultsContext'

export default function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (window.location.hostname !== '127.0.0.1') return

    const localhostUrl = new URL(window.location.href)
    localhostUrl.hostname = 'localhost'
    window.location.replace(localhostUrl.toString())
  }, [])

  return (
    <SessionProvider>
      <DhabaRouteResultsProvider>{children}</DhabaRouteResultsProvider>
    </SessionProvider>
  )
}
