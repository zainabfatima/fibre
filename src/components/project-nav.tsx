"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"

export function ProjectNav({
  projectId,
  invoiceTracking,
  pendingReviews = 0,
}: {
  projectId: string
  invoiceTracking: boolean
  pendingReviews?: number
}) {
  const pathname = usePathname()
  const search = useSearchParams()
  const base = `/projects/${projectId}`
  const links = [
    { key: "expenses", href: "", label: "Expenses" },
    ...(invoiceTracking
      ? [{ key: "needs", href: "?tab=needs", label: "Needs invoicing" }]
      : []),
    { key: "upload", href: "/upload", label: "Upload" },
    { key: "review", href: "/review", label: pendingReviews > 0 ? `Review (${pendingReviews})` : "Review" },
    { key: "payments", href: "/payments", label: "Money received" },
    ...(invoiceTracking ? [{ key: "invoices", href: "/invoices", label: "Invoices" }] : []),
    { key: "share", href: "/share", label: "Share" },
    { key: "settings", href: "/settings", label: "Settings" },
  ]

  return (
    <nav className="flex touch-pan-x gap-1 overflow-x-auto overscroll-x-contain border-b border-border bg-background px-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden">
      {links.map((link) => {
        const href = `${base}${link.href}`
        const active =
          link.key === "needs"
            ? pathname === base && search.get("tab") === "needs"
            : link.key === "expenses"
              ? pathname === base && search.get("tab") !== "needs"
              : pathname === href || pathname.startsWith(`${href}/`)
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
