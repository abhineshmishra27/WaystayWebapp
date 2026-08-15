import type { Role } from '@prisma/client'

declare module 'next-auth' {
  interface User {
    id: string
    role: Role
    avatarUrl?: string | null
    isActive?: boolean
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: Role
      avatarUrl?: string | null
      isActive: boolean
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: Role
    avatarUrl?: string | null
    isActive?: boolean
  }
}
