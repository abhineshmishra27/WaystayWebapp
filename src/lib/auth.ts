import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import type { Role } from '@prisma/client'

const ROLES: readonly Role[] = ['ADMIN', 'OWNER', 'CUSTOMER']
const googleAuthEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET)

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
    ...(googleAuthEnabled
      ? [
          GoogleProvider({
            clientId: process.env.AUTH_GOOGLE_ID as string,
            clientSecret: process.env.AUTH_GOOGLE_SECRET as string,
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider !== 'google') return true
      if (!user.email || profile?.email_verified !== true) return false

      const { prisma } = await import('@/lib/db')
      const existingUser = await prisma.user.findUnique({
        where: { email: user.email },
      })

      if (existingUser && !existingUser.isActive) return false

      if (existingUser) {
        await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            avatarUrl: existingUser.avatarUrl ?? user.image,
          },
        })
        return true
      }

      const bcrypt = (await import('bcryptjs')).default
      const passwordHash = await bcrypt.hash(
        `${globalThis.crypto.randomUUID()}${globalThis.crypto.randomUUID()}`,
        12
      )

      await prisma.user.create({
        data: {
          email: user.email,
          name: user.name || user.email.split('@')[0],
          passwordHash,
          role: 'CUSTOMER',
          avatarUrl: user.image,
        },
      })
      return true
    },
    async jwt({ token, user, account, trigger, session }) {
      if (account?.provider === 'google' && token.email) {
        const { prisma } = await import('@/lib/db')
        const localUser = await prisma.user.findUnique({
          where: { email: token.email },
          select: { id: true, role: true, avatarUrl: true, isActive: true },
        })

        if (localUser?.isActive) {
          token.sub = localUser.id
          token.role = localUser.role
          token.avatarUrl = localUser.avatarUrl
        }
      }
      if (user) {
        if (isRole(user.role)) token.role = user.role
        if ('avatarUrl' in user) token.avatarUrl = user.avatarUrl ?? null
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
