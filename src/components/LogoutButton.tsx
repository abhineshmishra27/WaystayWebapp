'use client'

import { signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

type LogoutButtonProps = {
  className?: string
}

export default function LogoutButton({ className = 'text-xs text-red-500 mt-2 hover:underline' }: LogoutButtonProps) {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const handleSignOut = async () => {
    setIsSigningOut(true)
    await signOut({ redirect: false })
    router.replace('/')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className={className}
    >
      {isSigningOut ? 'Signing out...' : 'Sign out'}
    </button>
  )
}
