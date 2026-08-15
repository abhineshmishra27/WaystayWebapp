import { redirect } from 'next/navigation'

export default function LegacyAdminAuditPage() {
  redirect('/admin/audit-logs')
}
