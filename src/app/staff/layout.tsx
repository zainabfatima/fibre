import { requireStaff } from "@/lib/staff"

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await requireStaff()
  return children
}
