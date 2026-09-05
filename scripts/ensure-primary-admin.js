const { PrismaClient } = require('@prisma/client')
const { PrismaPg } = require('@prisma/adapter-pg')
const { resolveDatabaseUrl } = require('./database-url')

const PRIMARY_ADMIN_EMAIL = 'waystayrooms@gmail.com'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: resolveDatabaseUrl() }) })

async function main() {
  const existing = await prisma.user.findFirst({
    where: { email: { equals: PRIMARY_ADMIN_EMAIL, mode: 'insensitive' } },
    select: { id: true, email: true, role: true, isActive: true },
  })

  if (!existing) {
    throw new Error(`No account exists for ${PRIMARY_ADMIN_EMAIL}. Sign in with Google once, then run this command again.`)
  }

  const existingBootstrapLog = await prisma.auditLog.findFirst({
    where: { action: 'PRIMARY_ADMIN_BOOTSTRAPPED', targetType: 'User', targetId: existing.id },
    select: { id: true, metadata: true },
  })
  const user = await prisma.$transaction(async transaction => {
    const updated = await transaction.user.update({
      where: { id: existing.id },
      data: { email: PRIMARY_ADMIN_EMAIL, role: 'ADMIN', isActive: true },
      select: { id: true, email: true, role: true, isActive: true },
    })
    const bootstrapMetadata = {
      before: {
        role: existingBootstrapLog?.metadata?.previousRole ?? existing.role,
        isActive: existingBootstrapLog?.metadata?.previousIsActive ?? existing.isActive,
      },
      after: { role: 'ADMIN', isActive: true },
      reason: 'Initial protected administrator bootstrap.',
      email: PRIMARY_ADMIN_EMAIL,
    }
    if (!existingBootstrapLog) {
      await transaction.auditLog.create({
        data: {
          adminId: updated.id,
          action: 'PRIMARY_ADMIN_BOOTSTRAPPED',
          targetType: 'User',
          targetId: updated.id,
          metadata: bootstrapMetadata,
        },
      })
    } else {
      await transaction.auditLog.update({ where: { id: existingBootstrapLog.id }, data: { metadata: bootstrapMetadata } })
    }
    return updated
  })
  console.log(`Primary admin ready: ${user.email} (${user.role}, ${user.isActive ? 'active' : 'inactive'})`)
}

main()
  .catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
