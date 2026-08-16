import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { requireApiPermission } from '@/lib/api-rbac'
import { prisma } from '@/lib/db'
import { sendPartnerApplicationDecisionEmail } from '@/lib/email'
import { PERMISSIONS } from '@/lib/rbac'

const APPROVAL_CONFIRMATION = 'APPROVE_OWNER_ACCOUNT'

const decisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('APPROVE'),
    confirmation: z.literal(APPROVAL_CONFIRMATION),
    reason: z.string().trim().min(5).max(500),
  }).strict(),
  z.object({
    action: z.literal('REJECT'),
    reason: z.string().trim().min(5).max(500),
  }).strict(),
])

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const permissionError = requireApiPermission(session, PERMISSIONS.PARTNER_APPLICATION_MANAGE)
  if (permissionError) return permissionError

  const parsed = decisionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'A reason and explicit approval confirmation are required.' }, { status: 400 })
  }

  const { id } = await params
  try {
    const application = await prisma.partnerApplication.findUnique({ where: { id } })
    if (!application) return NextResponse.json({ error: 'Partner application not found.' }, { status: 404 })
    if (application.status !== 'PENDING') {
      return NextResponse.json({ error: `This application has already been ${application.status.toLowerCase()}.` }, { status: 409 })
    }

    if (parsed.data.action === 'REJECT') {
      const rejected = await prisma.$transaction(async transaction => {
        const result = await transaction.partnerApplication.update({
          where: { id },
          data: {
            status: 'REJECTED',
            reviewedById: session!.user.id,
            reviewedAt: new Date(),
            reviewReason: parsed.data.reason,
            passwordHash: 'REJECTED_APPLICATION',
          },
        })
        await transaction.auditLog.create({
          data: {
            adminId: session!.user.id,
            action: 'PARTNER_APPLICATION_REJECTED',
            targetType: 'PartnerApplication',
            targetId: id,
            metadata: {
              before: { status: application.status },
              after: { status: 'REJECTED' },
              applicantEmail: application.email,
              reason: parsed.data.reason,
            },
          },
        })
        return result
      })
      sendPartnerApplicationDecisionEmail(rejected, false, parsed.data.reason).catch(error => {
        console.error('Partner rejection email failed:', error)
      })
      return NextResponse.json({ application: { id: rejected.id, status: rejected.status } })
    }

    const matchingUsers = await prisma.user.findMany({
      where: { OR: [{ email: { equals: application.email, mode: 'insensitive' } }, { phone: application.phone }] },
      select: { id: true, email: true, phone: true, role: true },
    })
    if (matchingUsers.length > 1 || matchingUsers.some(user => user.email.toLowerCase() !== application.email || user.phone !== application.phone)) {
      return NextResponse.json({ error: 'The application email or mobile number now conflicts with another user account.' }, { status: 409 })
    }

    const approved = await prisma.$transaction(async transaction => {
      const existingUser = matchingUsers[0]
      const owner = existingUser
        ? await transaction.user.update({
            where: { id: existingUser.id },
            data: { role: 'OWNER', isActive: true },
            select: { id: true, name: true, email: true, phone: true, role: true, isActive: true },
          })
        : await transaction.user.create({
            data: {
              name: application.fullName,
              email: application.email,
              phone: application.phone,
              passwordHash: application.passwordHash,
              role: 'OWNER',
              isActive: true,
            },
            select: { id: true, name: true, email: true, phone: true, role: true, isActive: true },
          })

      const result = await transaction.partnerApplication.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedById: session!.user.id,
          reviewedAt: new Date(),
          reviewReason: parsed.data.reason,
          passwordHash: 'ACCOUNT_CREDENTIAL_MOVED_TO_USER',
        },
      })
      await transaction.auditLog.create({
        data: {
          adminId: session!.user.id,
          action: 'PARTNER_APPLICATION_APPROVED',
          targetType: 'PartnerApplication',
          targetId: id,
          metadata: {
            before: { status: application.status },
            after: { status: 'APPROVED', role: 'OWNER', isActive: true },
            applicantEmail: application.email,
            ownerUserId: owner.id,
            existingAccountPromoted: Boolean(existingUser),
            reason: parsed.data.reason,
          },
        },
      })
      return { application: result, owner }
    })

    sendPartnerApplicationDecisionEmail(approved.application, true).catch(error => {
      console.error('Partner approval email failed:', error)
    })

    return NextResponse.json({
      application: { id: approved.application.id, status: approved.application.status },
      owner: approved.owner,
    })
  } catch (error) {
    console.error('Partner application decision error:', error)
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {
      return NextResponse.json({ error: 'An account with this email address or mobile number already exists.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'The partner application could not be updated.' }, { status: 500 })
  }
}
