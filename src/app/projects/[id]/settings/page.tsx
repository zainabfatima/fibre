import { rotateShareToken, revokeShareToken, saveBudgets } from "@/app/actions/projects"
import { ProjectForm } from "@/components/project-form"
import { Button } from "@/components/ui/button"
import { appBaseUrl, getProject, listBudgets, listCategories } from "@/lib/queries"
import { formatCategory } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [project, categories, budgets] = await Promise.all([
    getProject(id),
    listCategories(),
    listBudgets(id),
  ])
  if (!project) return null
  const budgetByCategory = new Map(budgets.map((budget) => [budget.category_id, budget.budget_amount]))
  const share = project.share_token
    ? `${appBaseUrl()}/share/${project.share_token}`
    : null

  return (
    <div className="grid gap-8 px-4 py-4 lg:grid-cols-2">
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="mb-4 font-medium">Project</h2>
        <ProjectForm project={project} />
      </section>
      <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Client share link</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Anyone with this link can view receipts and invoices. They cannot edit.
        </p>
        {share ? <p className="mt-3 break-all text-sm">{share}</p> : <p className="mt-3 text-sm">No active link.</p>}
        <div className="mt-3 flex gap-2">
          <form action={async () => { "use server"; await rotateShareToken(id) }}>
            <Button type="submit">{share ? "Regenerate" : "Create link"}</Button>
          </form>
          {share ? (
            <form action={async () => { "use server"; await revokeShareToken(id) }}>
              <Button type="submit" variant="outline">
                Revoke
              </Button>
            </form>
          ) : null}
        </div>
      </section>
      <section className="lg:col-span-2">
        <h2 className="mb-3 font-medium">Category budgets</h2>
        <form action={saveBudgets} className="grid gap-2">
          <input type="hidden" name="projectId" value={id} />
          <div className="grid gap-2 sm:grid-cols-2">
            {categories.map((category) => (
              <label key={category.id} className="grid grid-cols-1 items-center gap-2 text-sm min-[480px]:grid-cols-[1fr_7.5rem]">
                <span>{formatCategory(category.code, category.name)}</span>
                <input
                  name={`budget_${category.id}`}
                  defaultValue={budgetByCategory.get(category.id) ?? ""}
                  placeholder="0.00"
                  className="h-8 rounded-lg border border-input bg-transparent px-2"
                />
              </label>
            ))}
          </div>
          <Button type="submit" className="mt-3 w-fit">
            Save budgets
          </Button>
        </form>
      </section>
    </div>
  )
}
