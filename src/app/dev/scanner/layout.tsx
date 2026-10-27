import { requireAdmin } from "@/lib/db"

export default async function DevScannerLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return children
}
