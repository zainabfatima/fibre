import { notFound } from "next/navigation"

import { AppHeader } from "@/components/app-header"
import { ClientLink } from "@/components/client-link"
import { LiveRefresh } from "@/components/live-refresh"
import { ProjectNav } from "@/components/project-nav"
import { clientCodeFromName } from "@/lib/client-code"
import { countPendingReviews, getProject } from "@/lib/queries"

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [project, pendingReviews] = await Promise.all([getProject(id), countPendingReviews(id)])
  if (!project) notFound()

  return (
    <>
      <AppHeader />
      <LiveRefresh />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{project.name}</h1>
          <p className="text-sm break-words text-muted-foreground">
            <span className="block sm:inline">{project.address || "No address"}</span>
            <span className="hidden sm:inline"> · </span>
            <span className="block sm:inline">{project.client_name || "No client"}</span>
          </p>
        </div>
        <ClientLink code={clientCodeFromName(project.name)} />
      </div>
      <ProjectNav
        projectId={id}
        invoiceTracking={project.invoice_tracking}
        pendingReviews={pendingReviews}
      />
      {children}
    </>
  )
}
