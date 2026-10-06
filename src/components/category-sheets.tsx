"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { assignInvoiceNumber, deleteExpense, setExpenseBillingStatus, updateExpenseFields } from "@/app/actions/expenses"
import { uploadInvoiceFile } from "@/app/actions/invoices"
import { StatusBadge } from "@/components/status-badge"
import type { SheetRow } from "@/components/expense-sheet"
import { formatCategory } from "@/lib/format"
import { centsToMoney, formatMoney, sumCents } from "@/lib/money"

type CategoryOption = { id: number; code: number; name: string }

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

  async function saveAmount(row: SheetRow, value: string) {
    const result = await updateExpenseFields({ projectId, expenseId: row.id, amount: value })
    if (result.error) toast.error(result.error)
    else router.refresh()
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
          rows={sectionRows}
          projectId={projectId}
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
          projectId={projectId}
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

function CategoryBlock({
  title,
  rows,
  projectId,
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
  rows: SheetRow[]
  projectId: string
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
  if (rows.length === 0) {
    return (
      <>
        <div className="flex items-baseline justify-between gap-3 border-b border-border/70 px-1 py-2.5 md:hidden">
          <h3 className="min-w-0 text-sm leading-snug break-words text-muted-foreground">{title}</h3>
          <p className="shrink-0 text-sm tabular-nums text-muted-foreground">{total}</p>
        </div>
        <section className="hidden overflow-hidden rounded-xl border-l-4 border-l-primary bg-card ring-1 ring-foreground/10 md:block">
          <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted px-3 py-2">
            <h3 className="font-medium">{title}</h3>
            <p className="text-sm tabular-nums">{total}</p>
          </header>
          <p className="px-3 py-3 text-sm text-muted-foreground">No expenses</p>
        </section>
      </>
    )
  }
  return (
    <section className="mt-2 overflow-hidden rounded-xl border-l-4 border-l-primary bg-card ring-1 ring-foreground/10 md:mt-0">
      <header className="flex items-baseline justify-between gap-3 border-b border-border bg-muted px-3 py-3">
        <h3 className="min-w-0 font-medium leading-snug break-words">{title}</h3>
        <p className="shrink-0 text-base font-semibold tabular-nums">{total}</p>
      </header>
      <>
        <div className="grid md:hidden">
          {rows.map((row) => (
            <article key={row.id} className="border-b border-border/70 p-3">
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
                    <p className="shrink-0 text-base font-semibold tabular-nums">{formatMoney(row.amount)}</p>
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
                  <label className="grid gap-1 text-sm">
                    <span className="text-muted-foreground">Amount</span>
                    <input
                      key={`${row.id}-${row.amount}`}
                      defaultValue={formatMoney(row.amount).replace("$", "")}
                      onBlur={(event) => onAmount(row, event.target.value)}
                      inputMode="decimal"
                      className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-base tabular-nums"
                    />
                  </label>
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
          <p className="bg-muted/60 px-3 py-3 text-sm font-semibold tabular-nums">Total {total}</p>
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
                <tr key={row.id} className="border-b border-border/70">
                  <td className="px-3 py-2 whitespace-nowrap">{row.date || "—"}</td>
                  <td className="max-w-40 truncate px-3 py-2">{row.vendor || "—"}</td>
                  <td className="px-3 py-2">
                    <input
                      key={`${row.id}-${row.amount}`}
                      defaultValue={formatMoney(row.amount).replace("$", "")}
                      onBlur={(event) => onAmount(row, event.target.value)}
                      inputMode="decimal"
                      className="h-9 w-24 rounded-lg border border-input bg-transparent px-2 text-right text-sm tabular-nums"
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
                  Total
                </td>
                <td className="px-3 py-2 tabular-nums">{total}</td>
                <td colSpan={invoiceTracking ? 6 : 3} />
              </tr>
            </tbody>
          </table>
        </div>
        </>
    </section>
  )
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
