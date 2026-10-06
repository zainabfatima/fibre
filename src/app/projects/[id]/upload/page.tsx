import { UploadQueue } from "@/components/upload-queue"
import { listCategories } from "@/lib/queries"

export default async function UploadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const categories = (await listCategories(true))
    .map((category) => ({ id: category.id, code: category.code, name: category.name }))
    .sort((a, b) => a.code - b.code)
  return <UploadQueue projectId={id} categories={categories} />
}
