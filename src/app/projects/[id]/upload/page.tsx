import { UploadQueue } from "@/components/upload-queue"

export default async function UploadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <UploadQueue projectId={id} />
}
