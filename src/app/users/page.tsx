import { AppHeader } from "@/components/app-header"
import { UsersManager } from "@/components/users-manager"
import { loadUsersPage } from "@/lib/user-accounts"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Users",
}

export default async function UsersPage() {
  const data = await loadUsersPage()
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">
            Approve a signup, set the user ID and password, and assign one project. That person can open only that project. An admin can use the whole tracker. Signup and approval mail goes to admin@fibreconstruction.com with a copy to joe@fibreconstruction.com, and the approval is also emailed to the user.
          </p>
        </div>
        <UsersManager projects={data.projects} requests={data.requests} accounts={data.accounts} />
      </main>
    </>
  )
}
