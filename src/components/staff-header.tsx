import Link from "next/link"

import { SignOutButton } from "@/components/auth/sign-out-button"
import { BrandLogo } from "@/components/brand-logo"

export function StaffHeader({ projectsHref = true }: { projectsHref?: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b-4 border-primary bg-card pt-[env(safe-area-inset-top)] shadow-sm">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <BrandLogo href="/staff" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-tight">Progress pictures</p>
            {projectsHref ? (
              <Link href="/staff" className="text-sm text-muted-foreground underline">
                All projects
              </Link>
            ) : null}
          </div>
        </div>
        <SignOutButton />
      </div>
    </header>
  )
}
