import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import type { Role } from '@prisma/client'
import { normalizeIdentifier, verifyOtp } from '@/lib/otp'
import { verifyRegistrationLoginToken } from '@/lib/registration-login-token'

const ROLES: readonly Role[] = ['ADMIN', 'OWNER', 'CUSTOMER']
const googleAuthEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET)

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && ROLES.includes(value as Role)
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        identifier: { label: 'Email or mobile', type: 'text' },
        phone: { label: 'Mobile number', type: 'tel' },
        otp: { label: 'OTP', type: 'text' },
        registrationToken: { label: 'Registration token', type: 'text' },
        requiredRole: { label: 'Required role', type: 'text' },
      },
      async authorize(credentials) {
        if (credentials?.registrationToken) {
          const userId = verifyRegistrationLoginToken(String(credentials.registrationToken))
          if (!userId) return null

          const { prisma } = await import('@/lib/db')
          const user = await prisma.user.findFirst({ where: { id: userId, isActive: true } })
          if (!user || (credentials.requiredRole && user.role !== credentials.requiredRole)) return null
          return { id: user.id, email: user.email, name: user.name, role: user.role, avatarUrl: user.avatarUrl }
        }
        if (credentials?.identifier && credentials?.otp) {
          const identifier = normalizeIdentifier(String(credentials.identifier))
          if (!await verifyOtp(identifier, 'login', String(credentials.otp))) return null

          const { prisma } = await import('@/lib/db')
          const user = await prisma.user.findFirst({ where: { isActive: true, OR: [{ email: identifier }, { phone: identifier }] } })
          if (!user || (credentials.requiredRole && user.role !== credentials.requiredRole)) return null
          return { id: user.id, email: user.email, name: user.name, role: user.role, avatarUrl: user.avatarUrl }
        }
        if (!credentials?.identifier || !credentials?.password) return null

        const { prisma } = await import('@/lib/db')
        const bcrypt = (await import('bcryptjs')).default

        const identifier = normalizeIdentifier(String(credentials.identifier))
        const user = await prisma.user.findFirst({ where: { isActive: true, OR: [{ email: identifier }, { phone: identifier }] } })

        if (!user || !user.isActive) return null
        if (credentials.requiredRole && user.role !== credentials.requiredRole) return null

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
