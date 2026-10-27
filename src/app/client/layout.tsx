import { redirect } from "next/navigation"

import { getStaffUser } from "@/lib/app-session"

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  if (await getStaffUser()) redirect("/staff")
  return children
}
