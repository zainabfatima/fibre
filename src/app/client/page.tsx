import { redirect } from "next/navigation"

import { ClientLoginForm } from "@/components/client-login-form"
import { ClientShell } from "@/components/client-shell"
import { clientPathForProject, getClientAccountUser } from "@/lib/app-session"
import { getClientProjectCode } from "@/lib/client-session"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Project expenses",
  robots: { index: false, follow: false },
}

export default async function ClientHomePage() {
  const account = await getClientAccountUser()
  if (account?.project_id) {
    const destination = await clientPathForProject(account.project_id)
    if (destination) redirect(destination)
    return (
      <ClientShell>
        <ClientLoginForm initialError="Your project name needs to start with the project number before the client view can open." />
      </ClientShell>
    )
  }

  const code = await getClientProjectCode()
  if (code) redirect(`/client/${code}`)

  return (
    <ClientShell>
      <ClientLoginForm />
    </ClientShell>
  )
}
