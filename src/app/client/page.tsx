import { redirect } from "next/navigation"

import { ClientLoginForm } from "@/components/client-login-form"
import { ClientProjectList } from "@/components/client-project-list"
import { ClientShell } from "@/components/client-shell"
import { getClientAccountUser } from "@/lib/app-session"
import { projectsForClient } from "@/lib/client-projects"
import { getClientProjectCode } from "@/lib/client-session"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Project expenses",
  robots: { index: false, follow: false },
}

export default async function ClientHomePage() {
  const account = await getClientAccountUser()
  if (account) {
    const projects = await projectsForClient(account.project_ids)
    if (projects.length === 1 && projects[0].code) redirect(`/client/${projects[0].code}`)
    return (
      <ClientShell leave>
        {projects.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">No project is assigned to this account.</p>
        ) : projects.length === 1 ? (
          <p className="px-4 text-sm text-muted-foreground">
            Your project name needs to start with the project number before the client view can open.
          </p>
        ) : (
          <ClientProjectList projects={projects} />
        )}
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
