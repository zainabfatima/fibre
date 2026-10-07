"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { assignInvoiceNumber, deleteExpense, setExpenseBillingStatus, updateExpenseFields } from "@/app/actions/expenses"
import { uploadInvoiceFile } from "@/app/actions/invoices"
import { CategoryBudgetHeading } from "@/components/category-budget-heading"
import { useExpenseSearch } from "@/components/expense-amount-search"
import { StatusBadge } from "@/components/status-badge"
import type { SheetRow } from "@/components/expense-sheet"
import { formatCategory } from "@/lib/format"
import { centsToMoney, formatMoney, moneyToCents, parseMoneyInput, sumCents } from "@/lib/money"

type CategoryOption = { id: number; code: number; name: string; budget: string | number }

export function CategorySheets({
  projectId,
  categories,
  rows,
  invoiceTracking,
  mode,
}: {
  projectId: string
  categories: CategoryOption[]
  rows: SheetRow[]
  invoiceTracking: boolean
  mode: "all" | "needs"
}) {
  const router = useRouter()
  const [preview, setPreview] = useState<SheetRow | null>(null)
  const scoped = rows.filter((row) => mode !== "needs" || row.invoiceStatus === "not_invoiced")
  const sections = categories.map((category) => ({
    category,
    rows: scoped.filter((row) => row.categoryId === category.id),
  }))
  const uncategorized = scoped.filter((row) => row.categoryId == null)
  const shown = mode === "needs" ? sections.filter((section) => section.rows.length > 0) : sections
  const search = useExpenseSearch()
  const matchIds = search?.matchIds ?? []
  const activeIndex = search?.activeIndex ?? 0
  const searchQuery = search?.query ?? ""
  const seenQuery = useRef(searchQuery)

  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (!trimmed || matchIds.length === 0) {
      seenQuery.current = searchQuery
      return
    }
    const id = matchIds[activeIndex]
    if (!id) return
    const delay = seenQuery.current === searchQuery ? 0 : 200
    seenQuery.current = searchQuery
    const timer = window.setTimeout(() => {
      const nodes = document.querySelectorAll<HTMLElement>(`[data-expense-id="${CSS.escape(id)}"]`)
      const visible = Array.from(nodes).find((node) => node.getClientRects().length > 0)
      visible?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [searchQuery, matchIds, activeIndex])

  async function saveAmount(row: SheetRow, value: string) {
    const cents = parseMoneyInput(value)
    if (cents == null || cents < 0) {
      toast.error("Enter an amount like 125.00")
      return
    }
    if (cents === moneyToCents(row.amount)) return
    const result = await updateExpenseFields({ projectId, expenseId: row.id, amount: value })
    if (result.error) toast.error(result.error)
    else {
      toast.success("Amount saved")
      router.refresh()
    }
  }

  async function saveInvoice(row: SheetRow, number: string) {
    const result = await assignInvoiceNumber({
      projectId,
      expenseId: row.id,
      invoiceNumber: number,
    })
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  async function saveStatus(row: SheetRow, status: "unpaid" | "paid" | "partial") {
    const result = await setExpenseBillingStatus({ projectId, expenseId: row.id, status })
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  async function saveCategory(row: SheetRow, categoryId: number) {
    const result = await updateExpenseFields({ projectId, expenseId: row.id, categoryId })
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  async function removeReceipt(row: SheetRow) {
    const label = row.vendor?.trim() || "this receipt"
    if (!window.confirm(`Delete ${label}?`)) return
    const result = await deleteExpense(projectId, row.id)
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  return (
    <div className="flex flex-col gap-1 px-3 pb-2 sm:gap-4 sm:px-4">
      {shown.map(({ category, rows: sectionRows }) => (
        <CategoryBlock
          key={category.id}
          title={formatCategory(category.code, category.name)}
          budget={category.budget}
          rows={sectionRows}
          matchIds={matchIds}
          activeIndex={activeIndex}
          projectId={projectId}
          categoryKey={category.id}
          needs={mode === "needs"}
          invoiceTracking={invoiceTracking}
          categories={categories}
          onPreview={setPreview}
          onAmount={saveAmount}
          onInvoice={saveInvoice}
          onStatus={saveStatus}
          onCategory={saveCategory}
          onDelete={removeReceipt}
        />
      ))}
      {uncategorized.length > 0 ? (
        <CategoryBlock
          title="Uncategorized"
          rows={uncategorized}
          matchIds={matchIds}
          activeIndex={activeIndex}
          projectId={projectId}
          categoryKey="none"
          needs={mode === "needs"}
          invoiceTracking={invoiceTracking}
          categories={categories}
          onPreview={setPreview}
          onAmount={saveAmount}
          onInvoice={saveInvoice}
          onStatus={saveStatus}
          onCategory={saveCategory}
          onDelete={removeReceipt}
        />
      ) : null}
      {preview ? (
        <div className="fixed inset-0 z-40 grid place-items-end bg-black/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:place-items-center sm:p-4" onClick={() => setPreview(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl bg-card p-4" onClick={(event) => event.stopPropagation()}>
            {preview.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.thumbUrl} alt="Receipt" className="max-h-[70vh] w-full object-contain" />
            ) : (
              <p>Open the file to view this receipt.</p>
            )}
            <div className="mt-3 flex gap-2">
              <a href={`/r/${preview.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
                Open full size
              </a>
              <button type="button" onClick={() => setPreview(null)} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-4 text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function AmountInput({
  row,
  highlighted,
  onAmount,
  className,
}: {
  row: SheetRow
  highlighted: boolean
  onAmount: (row: SheetRow, value: string) => void
  className: string
}) {
  return (
    <input
      key={`${row.id}-${row.amount}`}
      defaultValue={formatMoney(row.amount).replace("$", "")}
      aria-label={`Amount for ${row.vendor || "receipt"}`}
      inputMode="decimal"
      enterKeyHint="done"
      onBlur={(event) => onAmount(row, event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return
        event.preventDefault()
        event.currentTarget.blur()
      }}
      className={`${className} ${highlighted ? "border-primary bg-amber-200 font-semibold dark:bg-amber-900" : "border-input bg-transparent"}`}
    />
  )
}

function CategoryBlock({
  title,
  budget,
  rows,
  matchIds,
  activeIndex,
  projectId,
  categoryKey,
  needs,
  invoiceTracking,
  categories,
  onPreview,
  onAmount,
  onInvoice,
  onStatus,
  onCategory,
  onDelete,
}: {
  title: string
  budget?: string | number | null
  rows: SheetRow[]
  matchIds: string[]
  activeIndex: number
  projectId: string
  categoryKey: number | "none"
  needs: boolean
  invoiceTracking: boolean
  categories: CategoryOption[]
  onPreview: (row: SheetRow) => void
  onAmount: (row: SheetRow, value: string) => void
  onInvoice: (row: SheetRow, number: string) => void
  onStatus: (row: SheetRow, status: "unpaid" | "paid" | "partial") => void
  onCategory: (row: SheetRow, categoryId: number) => void
  onDelete: (row: SheetRow) => void
}) {
  const total = formatMoney(centsToMoney(sumCents(rows.map((row) => row.amount))))
  const budgetText = budget == null ? null : formatMoney(budget)
  if (rows.length === 0) {
    return (
      <>
        <div className="border-b border-border/70 px-1 py-2.5 md:hidden">
          <div className="flex items-start justify-between gap-3">
            <CategoryBudgetHeading title={title} budget={budgetText} spent={total} compact />
          </div>
          <CategoryPdfLink projectId={projectId} categoryKey={categoryKey} title={title} needs={needs} fullWidth />
        </div>
        <section className="hidden overflow-hidden rounded-xl border-l-4 border-l-primary bg-card ring-1 ring-foreground/10 md:block">
          <header className="flex items-start justify-between gap-3 border-b border-border bg-muted px-3 py-2">
            <CategoryBudgetHeading title={title} budget={budgetText} spent={total} />
          </header>
          <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
            <p className="text-sm text-muted-foreground">No expenses</p>
            <CategoryPdfLink projectId={projectId} categoryKey={categoryKey} title={title} needs={needs} />
          </div>
        </section>
      </>
    )
  }
  return (
    <section className="mt-2 overflow-hidden rounded-xl border-l-4 border-l-primary bg-card ring-1 ring-foreground/10 md:mt-0">
      <header className="flex items-start justify-between gap-3 border-b border-border bg-muted px-3 py-3">
        <CategoryBudgetHeading title={title} budget={budgetText} spent={total} />
      </header>
      <>
        <div className="grid md:hidden">
          {rows.map((row) => (
            <article
              key={row.id}
              data-expense-id={row.id}
              className={`scroll-mt-48 border-b border-border/70 p-3 ${expenseHighlight(matchIds.includes(row.id), matchIds[activeIndex] === row.id)}`}
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => onPreview(row)}
                  className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted text-[10px]"
                >
                  {row.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.thumbUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    "Receipt"
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium leading-snug break-words">
                      {row.vendor || "Receipt"}
                      {row.pageCount && row.pageCount > 1 ? ` · ${row.pageCount} pages` : ""}
                    </p>
                    <AmountInput
                      row={row}
                      highlighted={matchIds.includes(row.id)}
                      onAmount={onAmount}
                      className="h-11 w-36 shrink-0 rounded-lg border px-2 text-right text-base font-semibold tabular-nums"
                    />
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{row.date || "No date"}</p>
                  {invoiceTracking ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm">{row.invoiceNumber ? `Invoice ${row.invoiceNumber}` : "No invoice"}</span>
                      <StatusBadge kind="invoice" status={row.invoiceId ? row.billingStatus : "not_invoiced"} />
                    </div>
                  ) : null}
                </div>
              </div>
              <div className={`mt-3 grid gap-2 ${invoiceTracking ? "grid-cols-2" : "grid-cols-1"}`}>
                <button
                  type="button"
                  onClick={() => onPreview(row)}
                  className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium"
                >
                  View receipt
                </button>
                {invoiceTracking && row.invoiceId && row.hasInvoiceFile ? (
                  <a
                    href={`/i/${row.invoiceId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium"
                  >
                    View invoice
                  </a>
                ) : invoiceTracking ? (
                  <span className="inline-flex min-h-11 items-center justify-center rounded-lg bg-muted px-3 text-center text-sm text-muted-foreground">
                    No invoice file
                  </span>
                ) : null}
              </div>
              <details className="mt-2">
                <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-medium text-muted-foreground">
                  Edit this expense
                </summary>
                <div className="grid gap-3 pb-2">
                  {invoiceTracking ? (
                    <>
                      <label className="grid gap-1 text-sm">
                        <span className="text-muted-foreground">Invoice #</span>
                        <input
                          key={`${row.id}-${row.invoiceNumber ?? ""}`}
                          defaultValue={row.invoiceNumber ?? ""}
                          onBlur={(event) => onInvoice(row, event.target.value)}
                          className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base"
                        />
                      </label>
                      {row.invoiceId ? (
                        <label className="grid gap-1 text-sm">
                          <span className="text-muted-foreground">Invoice status</span>
                          <select
                            value={row.billingStatus}
                            onChange={(event) => onStatus(row, event.target.value as "unpaid" | "paid" | "partial")}
                            className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base"
                          >
                            <option value="unpaid">Unpaid</option>
                            <option value="paid">Paid</option>
                            <option value="partial">Partial</option>
                          </select>
                        </label>
                      ) : null}
                      {row.invoiceId && !row.hasInvoiceFile ? (
                        <form action={uploadInvoiceFile}>
                          <input type="hidden" name="invoiceId" value={row.invoiceId} />
                          <input type="hidden" name="projectId" value={projectId} />
                          <input
                            name="file"
                            type="file"
                            accept="image/*,application/pdf"
                            aria-label={`Upload invoice ${row.invoiceNumber ?? ""}`}
                            className="w-full text-base"
                            onChange={(event) => {
                              if (event.target.files?.length) event.currentTarget.form?.requestSubmit()
                            }}
                          />
                        </form>
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <ChangeCategoryCell
                      categories={categories}
                      currentId={row.categoryId}
                      onChange={(categoryId) => onCategory(row, categoryId)}
                    />
                    <button
                      type="button"
                      onClick={() => onDelete(row)}
                      className="h-11 rounded-lg border border-input px-3 text-sm text-destructive"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </details>
            </article>
          ))}
          <div className="bg-muted/60 px-3 py-3">
            <p className="text-sm font-semibold tabular-nums">
              {budgetText ? `Budget ${budgetText} · Spent ${total}` : `Spent ${total}`}
            </p>
            <CategoryPdfLink projectId={projectId} categoryKey={categoryKey} title={title} needs={needs} fullWidth />
          </div>
        </div>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Receipt</th>
                <th className="px-3 py-2 font-medium">Change category</th>
                <th className="px-3 py-2 font-medium">Delete</th>
                {invoiceTracking ? (
                  <>
                    <th className="px-3 py-2 font-medium">Invoice #</th>
                    <th className="px-3 py-2 font-medium">Invoice status</th>
                    <th className="px-3 py-2 font-medium">Invoice view</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-expense-id={row.id}
                  className={`scroll-mt-48 border-b border-border/70 ${expenseHighlight(matchIds.includes(row.id), matchIds[activeIndex] === row.id)}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap">{row.date || "—"}</td>
                  <td className="max-w-40 truncate px-3 py-2">{row.vendor || "—"}</td>
                  <td className="px-3 py-2">
                    <AmountInput
                      row={row}
                      highlighted={matchIds.includes(row.id)}
                      onAmount={onAmount}
                      className="h-9 w-36 rounded-lg border px-2 text-right text-sm tabular-nums"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => onPreview(row)} className="h-12 w-12 overflow-hidden rounded border border-border">
                      {row.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={row.thumbUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-[10px]">File</span>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <ChangeCategoryCell
                      categories={categories}
                      currentId={row.categoryId}
                      onChange={(categoryId) => onCategory(row, categoryId)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onDelete(row)}
                      className="h-9 whitespace-nowrap rounded-lg border border-input px-2 text-sm text-destructive"
                    >
                      Delete
                    </button>
                  </td>
                  {invoiceTracking ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          key={`${row.id}-${row.invoiceNumber ?? ""}`}
                          defaultValue={row.invoiceNumber ?? ""}
                          onBlur={(event) => onInvoice(row, event.target.value)}
                          className="h-9 w-28 rounded-lg border border-input bg-transparent px-2 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {row.invoiceId ? (
                          <select
                            value={row.billingStatus}
                            onChange={(event) =>
                              onStatus(row, event.target.value as "unpaid" | "paid" | "partial")
                            }
                            className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
                          >
                            <option value="unpaid">Unpaid</option>
                            <option value="paid">Paid</option>
                            <option value="partial">Partial</option>
                          </select>
                        ) : (
                          <StatusBadge kind="invoice" status="not_invoiced" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {row.invoiceId && row.hasInvoiceFile ? (
                          <a href={`/i/${row.invoiceId}`} target="_blank" rel="noreferrer" className="underline">
                            View
                          </a>
                        ) : row.invoiceId ? (
                          <form action={uploadInvoiceFile}>
                            <input type="hidden" name="invoiceId" value={row.invoiceId} />
                            <input type="hidden" name="projectId" value={projectId} />
                            <input
                              name="file"
                              type="file"
                              accept="image/*,application/pdf"
                              aria-label={`Upload invoice ${row.invoiceNumber ?? ""}`}
                              className="max-w-36 text-xs"
                              onChange={(event) => {
                                if (event.target.files?.length) event.currentTarget.form?.requestSubmit()
                              }}
                            />
                          </form>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
              <tr className="bg-muted/60 font-medium">
                <td className="px-3 py-2" colSpan={2}>
                  Spent
                </td>
                <td className="px-3 py-2 tabular-nums">{total}</td>
                <td className="px-3 py-2" colSpan={invoiceTracking ? 6 : 3}>
                  <CategoryPdfLink projectId={projectId} categoryKey={categoryKey} title={title} needs={needs} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        </>
    </section>
  )
}

function CategoryPdfLink({
  projectId,
  categoryKey,
  title,
  needs,
  fullWidth = false,
}: {
  projectId: string
  categoryKey: number | "none"
  title: string
  needs: boolean
  fullWidth?: boolean
}) {
  const href = `/api/packet/${projectId}/${categoryKey}${needs ? "?needs=1" : ""}`
  return (
    <a
      href={href}
      download
      aria-label={`Download PDF for ${title}`}
      className={`inline-flex min-h-11 items-center justify-center rounded-lg border border-input bg-background px-3 text-sm font-medium ${fullWidth ? "mt-2 w-full" : ""}`}
    >
      Category PDF
    </a>
  )
}

function expenseHighlight(matched: boolean, active: boolean) {
  if (!matched) return ""
  const tint = "bg-amber-100 dark:bg-amber-950/50"
  return active ? `${tint} ring-2 ring-inset ring-primary` : tint
}

function ChangeCategoryCell({
  categories,
  currentId,
  onChange,
}: {
  categories: CategoryOption[]
  currentId: number | null
  onChange: (categoryId: number) => void
}) {
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="h-11 whitespace-nowrap rounded-lg border border-input px-3 text-sm md:h-9"
      >
        Change category
      </button>
    )
  }
  return (
    <select
      autoFocus
      defaultValue={currentId != null ? String(currentId) : ""}
      aria-label="Move receipt to category"
      onChange={(event) => {
        const next = Number(event.target.value)
        setOpen(false)
        if (!next || next === currentId) return
        onChange(next)
      }}
      onBlur={() => {
        window.setTimeout(() => setOpen(false), 150)
      }}
        className="h-11 w-full max-w-full rounded-lg border border-input bg-transparent px-2 text-base md:h-9 md:max-w-56 md:text-sm"
    >
      {currentId == null ? <option value="">Pick a category</option> : null}
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {formatCategory(category.code, category.name)}
        </option>
      ))}
    </select>
  )
}
