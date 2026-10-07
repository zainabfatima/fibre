import { ClientLink } from "@/components/client-link"
import { clientCodeFromName } from "@/lib/client-code"
import { getProject } from "@/lib/queries"

export const dynamic = "force-dynamic"

export default async function ProjectSharePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) return null

  return (
    <div className="grid gap-4 px-4 py-4">
      <div>
        <h2 className="text-lg font-medium">Share</h2>
        <p className="text-sm text-muted-foreground">
          Send this link to the client. They enter the project number to see expenses.
        </p>
      </div>
      <ClientLink code={clientCodeFromName(project.name)} />
    </div>
  )
}
