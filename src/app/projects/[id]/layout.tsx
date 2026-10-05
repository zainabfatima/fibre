import { notFound } from "next/navigation"

import { AppHeader } from "@/components/app-header"
import { LiveRefresh } from "@/components/live-refresh"
import { ProjectNav } from "@/components/project-nav"
import { getProject } from "@/lib/queries"

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) notFound()

  return (
    <>
      <AppHeader />
      <LiveRefresh />
      <div className="mx-auto flex w-full max-w-7xl items-end justify-between gap-4 px-4 pt-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{project.name}</h1>
          <p className="text-sm break-words text-muted-foreground">
            <span className="block sm:inline">{project.address || "No address"}</span>
            <span className="hidden sm:inline"> · </span>
            <span className="block sm:inline">{project.client_name || "No client"}</span>
          </p>
        </div>
      </div>
      <ProjectNav projectId={id} invoiceTracking={project.invoice_tracking} />
      {children}
    </>
  )
}
