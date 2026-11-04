import { requireAdmin } from "@/lib/db"

export default async function ScannerTestLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return children
}
