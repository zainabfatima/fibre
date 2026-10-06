import { updateCategory } from "@/app/actions/categories"
import { AppHeader } from "@/components/app-header"
import { BudgetSheetUpload } from "@/components/budget-sheet-upload"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatCategory } from "@/lib/format"
import { formatMoney } from "@/lib/money"
import { listCategories } from "@/lib/queries"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export default async function CategoriesPage() {
  const categories = await listCategories()
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
        <h1 className="text-2xl font-semibold">Categories</h1>
        <p className="text-sm text-muted-foreground">
          Codes stay fixed. You can rename a category, change its keywords, or hide it.
          The budget amount is the system default for every project.
        </p>
        <BudgetSheetUpload />
        {categories.map((category) => (
          <form key={category.id} action={updateCategory} className="grid gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10 lg:grid-cols-[180px_1fr_auto_auto] lg:items-center">
            <input type="hidden" name="id" value={category.id} />
            <div>
              <p className="text-sm font-medium">{formatCategory(category.code, category.name)}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                Budget {formatMoney(category.default_budget ?? 0)}
              </p>
            </div>
            <Input name="name" defaultValue={category.name} aria-label="Name" />
            <Input
              name="keywords"
              defaultValue={category.keywords.join(", ")}
              aria-label="Keywords"
              placeholder="keywords, comma separated"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isActive" defaultChecked={category.is_active} />
              Active
            </label>
            <Button type="submit" variant="outline" className="sm:col-start-4">
              Save
            </Button>
          </form>
        ))}
      </main>
    </>
  )
}
