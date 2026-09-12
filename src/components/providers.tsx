'use client'
import { SessionProvider } from 'next-auth/react'
import React from 'react'
import { DhabaRouteResultsProvider } from '@/components/dhabas/DhabaRouteResultsContext'

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <DhabaRouteResultsProvider>{children}</DhabaRouteResultsProvider>
    </SessionProvider>
  )
}
