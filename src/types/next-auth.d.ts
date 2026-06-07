import type { Role } from '@prisma/client'

declare module 'next-auth' {
  interface User {
    id: string
    role: Role
    avatarUrl?: string | null
  }
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: Role
      avatarUrl?: string | null
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: Role
    avatarUrl?: string | null
  }
}
