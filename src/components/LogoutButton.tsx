'use client'

import { signOut } from 'next-auth/react'

export default function LogoutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="text-xs text-red-500 mt-2 hover:underline"
    >
      Sign out
    </button>
  )
}
