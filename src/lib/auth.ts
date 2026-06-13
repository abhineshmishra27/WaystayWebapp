import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import type { Role } from '@prisma/client'

const ROLES: readonly Role[] = ['ADMIN', 'OWNER', 'CUSTOMER']

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.includes(value as Role)
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const { prisma } = await import('@/lib/db')
        const bcrypt = (await import('bcryptjs')).default

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        })

        if (!user || !user.isActive) return null

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        )

        if (!isValid) return null

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          avatarUrl: user.avatarUrl,
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = user.role
        token.avatarUrl = user.avatarUrl ?? null
      }
      if (trigger === 'update' && session?.user) {
        if (typeof session.user.name === 'string') token.name = session.user.name
        if (typeof session.user.avatarUrl === 'string' || session.user.avatarUrl === null) {
          token.avatarUrl = session.user.avatarUrl
        }
      }
      return token
    },
    session({ session, token }) {
      session.user.id = token.sub ?? ''
      if (isRole(token.role)) session.user.role = token.role
      session.user.avatarUrl = typeof token.avatarUrl === 'string' ? token.avatarUrl : null
      return session
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
})
