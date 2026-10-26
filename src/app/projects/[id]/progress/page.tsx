import { ProgressPictures } from "@/components/progress-pictures"
import { listCategories, listProgressPictures } from "@/lib/queries"

export const dynamic = "force-dynamic"

export default async function ProgressPicturesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [categories, pictures] = await Promise.all([listCategories(), listProgressPictures(id)])
  const byId = new Map(categories.map((category) => [category.id, category]))
  const active = categories
    .filter((category) => category.is_active)
    .map((category) => ({ id: category.id, code: category.code, name: category.name }))
    .sort((a, b) => a.code - b.code)

  return (
    <ProgressPictures
      projectId={id}
      categories={active}
      pictures={pictures.map((picture) => {
        const category = byId.get(picture.categoryId)
        return {
          id: picture.id,
          categoryId: picture.categoryId,
          categoryCode: category?.code ?? 0,
          categoryName: category?.name ?? "Category",
          createdAt: picture.createdAt,
          url: picture.url,
        }
      })}
    />
  )
}
