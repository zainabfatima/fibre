import Link from "next/link"

import { SignOutButton } from "@/components/auth/sign-out-button"
import { BrandLogo } from "@/components/brand-logo"

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 border-b-4 border-primary bg-card pt-[env(safe-area-inset-top)] shadow-sm">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-3 py-2 sm:gap-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <BrandLogo href="/" />
          <nav className="flex min-w-0 flex-wrap items-center gap-1">
            <Link href="/projects/new" className="rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent">
              New project
            </Link>
            <Link href="/settings/categories" className="rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent">
              Categories
            </Link>
          </nav>
        </div>
        <SignOutButton />
      </div>
    </header>
  )
}
