import { redirect } from 'next/navigation'
import HotelListingRequestForm from '@/components/owner/HotelListingRequestForm'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { PERMISSIONS, sessionHasPermission } from '@/lib/rbac'

export default async function NewOwnerHotelPage() {
  const session = await auth()
  if (!session || !sessionHasPermission(session, PERMISSIONS.OWNER_ACCESS)) redirect('/login?error=unauthorized')

  const owner = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { phone: true },
  })

  return <HotelListingRequestForm initialPhone={owner?.phone || ''} />
}
