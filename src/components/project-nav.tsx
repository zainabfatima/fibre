"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

import { stripZainab, withZainab } from "@/lib/zainab-path"
import { useZainab } from "@/components/view-mode"

export function ProjectNav({
  projectId,
  invoiceTracking,
  pendingReviews = 0,
}: {
  projectId: string
  invoiceTracking: boolean
  pendingReviews?: number
}) {
  const pathname = stripZainab(usePathname())
  const search = useSearchParams()
  const zainab = useZainab()
  const base = `/projects/${projectId}`
  const links = [
    { key: "expenses", href: "", label: "Expenses" },
    { key: "upload", href: "/upload", label: "Upload Receipts" },
    { key: "progress", href: "/progress", label: "Upload Progress Pictures" },
    { key: "client", href: "/client-paid", label: "Paid by client" },
    ...(invoiceTracking
      ? [{ key: "needs", href: "?tab=needs", label: "Needs invoicing" }]
      : []),
    { key: "review", href: "/review", label: pendingReviews > 0 ? `Review (${pendingReviews})` : "Review" },
    { key: "summary", href: "/summary", label: "Detailed summary" },
    { key: "payments", href: "/payments", label: "Funds Received" },
    ...(invoiceTracking ? [{ key: "invoices", href: "/invoices", label: "Invoices" }] : []),
    { key: "share", href: "/share", label: "Share" },
    { key: "settings", href: "/settings", label: "Settings" },
  ]

  return (
    <nav className="flex touch-pan-x gap-1 overflow-x-auto overscroll-x-contain border-b border-border bg-background px-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden">
      {links.map((link) => {
        const logicalHref = `${base}${link.href}`
        const href = withZainab(logicalHref, zainab)
        const tab = search.get("tab")
        const active =
          link.key === "needs"
            ? pathname === base && tab === "needs"
            : link.key === "expenses"
              ? pathname === base && tab !== "needs"
              : pathname === logicalHref || pathname.startsWith(`${logicalHref}/`)
        return (
          <Link
            key={link.key}
            href={href}
            className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium ${
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
