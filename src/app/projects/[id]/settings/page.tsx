import { saveBudgets } from "@/app/actions/projects"
import { BudgetSheetUpload } from "@/components/budget-sheet-upload"
import { DeleteProjectButton } from "@/components/delete-project-button"
import { ProjectForm } from "@/components/project-form"
import { Button } from "@/components/ui/button"
import { getProject, listCategories, listCategoryTotals } from "@/lib/queries"
import { formatCategory } from "@/lib/format"
import { centsToMoney, moneyToCents, formatMoney, amountOverBudget } from "@/lib/money"

export const dynamic = "force-dynamic"
export const maxDuration = 60

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [project, categories, totals] = await Promise.all([
    getProject(id),
    listCategories(),
    listCategoryTotals(id),
  ])
  if (!project) return null
  const budgetByCategory = new Map(
    totals.map((row) => [row.category_id, centsToMoney(moneyToCents(row.budget ?? 0))]),
  )
  const budgetKey = categories
    .map((category) => `${category.id}:${budgetByCategory.get(category.id) ?? "0.00"}`)
    .join("|")

  return (
    <div className="grid gap-8 px-4 py-4 lg:grid-cols-2">
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-4 font-medium">Project</h2>
        <ProjectForm project={project} />
        <div className="mt-8 border-t border-border pt-6">
          <h3 className="mb-1 text-sm font-medium">Delete project</h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Permanently removes this project, including receipts, expenses, invoices, and payments.
          </p>
          <DeleteProjectButton projectId={project.id} projectName={project.name} />
        </div>
      </section>
      <section className="lg:col-span-2 grid gap-4">
        <BudgetSheetUpload />
        <div>
          <h2 className="mb-1 font-medium">Category budgets</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Each amount starts as the system default. Saving a different amount applies only to this
            project. Saving the system amount again makes this project follow the next budget sheet.
          </p>
          <form key={budgetKey} action={saveBudgets} className="grid gap-2">
            <input type="hidden" name="projectId" value={id} />
            <div className="grid gap-2 sm:grid-cols-2">
              {categories.map((category) => {
                const budgetAmount = budgetByCategory.get(category.id) ?? "0.00"
                const spent = totals.find((row) => row.category_id === category.id)
                const overCents = amountOverBudget(budgetAmount, moneyToCents(spent?.total_spent ?? 0))
                const overBy = overCents == null ? null : formatMoney(centsToMoney(overCents))
                return (
                <label key={category.id} className={`grid grid-cols-1 items-center gap-2 text-sm min-[480px]:grid-cols-[1fr_7.5rem] ${overBy ? "rounded-lg bg-red-50 px-2 py-2 ring-1 ring-red-300" : ""}`}>
                  <span>
                    <span className={overBy ? "font-medium text-red-800" : ""}>{formatCategory(category.code, category.name)}</span>
                    {overBy ? <span className="mt-0.5 block text-red-700">Over budget by {overBy}</span> : null}
                  </span>
                  <input
                    name={`budget_${category.id}`}
                    defaultValue={budgetAmount}
                    inputMode="decimal"
                    className={`h-11 rounded-lg border bg-transparent px-2 min-[480px]:h-8 ${overBy ? "border-red-400" : "border-input"}`}
                  />
                </label>
                )
              })}
            </div>
            <Button type="submit" className="mt-3 min-h-11 w-full sm:w-fit">
              Save budgets
            </Button>
          </form>
        </div>
      </section>
    </div>
  )
}
