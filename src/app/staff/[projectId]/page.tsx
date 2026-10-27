import { ProgressPictures } from "@/components/progress-pictures"
import { StaffHeader } from "@/components/staff-header"
import { loadStaffProgress } from "@/lib/staff"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Progress pictures",
}

export default async function StaffProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>
}) {
  const { projectId } = await params
  const data = await loadStaffProgress(projectId)

  return (
    <>
      <StaffHeader />
      <div className="mx-auto w-full max-w-3xl px-4 pt-4">
        <h1 className="text-xl font-semibold tracking-tight break-words">{data.project.name}</h1>
        <p className="text-sm break-words text-muted-foreground">{data.project.address || "No address"}</p>
      </div>
      <ProgressPictures projectId={data.project.id} categories={data.categories} pictures={data.pictures} />
    </>
  )
}
