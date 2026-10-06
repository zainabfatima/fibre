import { signOutClient } from "@/app/actions/client-auth"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"

export function ClientShell({
  children,
  leave = false,
}: {
  children: React.ReactNode
  leave?: boolean
}) {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b-4 border-primary bg-card pt-[env(safe-area-inset-top)] shadow-sm">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            <BrandLogo href="/client" />
            <p className="min-w-0 text-[15px] font-semibold leading-tight break-words sm:text-lg">
              Projects Expense Tracker
            </p>
          </div>
          {leave ? (
            <form action={signOutClient}>
              <Button type="submit" variant="outline" className="h-10 px-3">
                Leave
              </Button>
            </form>
          ) : null}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-6">
        {children}
      </main>
    </div>
  )
}
