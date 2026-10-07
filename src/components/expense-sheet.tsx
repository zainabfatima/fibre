"use client"

import { useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { flexRender, type RowSelectionState } from "@tanstack/react-table"
import { getCoreRowModel, useLegacyTable } from "@tanstack/react-table/legacy"
import type { LegacyColumnDef } from "@tanstack/react-table/legacy"
import { useVirtualizer } from "@tanstack/react-virtual"
import { toast } from "sonner"

import {
  assignInvoiceNumber,
  linkExpensesToInvoice,
  setExpenseBillingStatus,
  updateExpenseFields,
} from "@/app/actions/expenses"
import { uploadInvoiceFile } from "@/app/actions/invoices"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { formatCategory } from "@/lib/format"
import {
  centsToMoney,
  formatMoney,
  sumCents,
} from "@/lib/money"

export type SheetRow = {
  id: string
  date: string | null
  vendor: string | null
  description: string | null
  categoryId: number | null
  categoryCode: number | null
  categoryName: string | null
  amount: string
  receiptNumber: string | null
  receiptTime: string | null
  paymentMethod: string | null
  cardLast4: string | null
  duplicateOf: string | null
  thumbUrl: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  hasInvoiceFile: boolean
  invoiceStatus: string
  billingStatus: string
  verificationStatus: string
  hasReceipt?: boolean
  pageCount?: number
}

type CategoryOption = { id: number; code: number; name: string }
type InvoiceOption = { id: string; invoiceNumber: string }

export function ExpenseSheet({
  projectId,
  rows,
  categories,
  invoices,
  mode,
  invoiceTracking = true,
  receivedCents,
}: {
  projectId: string
  rows: SheetRow[]
  categories: CategoryOption[]
  invoices: InvoiceOption[]
  mode: "all" | "needs"
  invoiceTracking?: boolean
  receivedCents?: number
}) {
  const router = useRouter()
  const [categoryId, setCategoryId] = useState("")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [invoiceStatus, setInvoiceStatus] = useState(mode === "needs" ? "not_invoiced" : "")
  const [vendor, setVendor] = useState("")
  const [grouped, setGrouped] = useState(false)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [preview, setPreview] = useState<SheetRow | null>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (mode === "needs" && row.invoiceStatus !== "not_invoiced") return false
      if (categoryId && String(row.categoryId) !== categoryId) return false
      if (from && (!row.date || row.date < from)) return false
      if (to && (!row.date || row.date > to)) return false
      if (invoiceStatus === "not_invoiced" && row.invoiceStatus !== "not_invoiced") return false
      if (
        invoiceStatus &&
        invoiceStatus !== "not_invoiced" &&
        (row.invoiceStatus === "not_invoiced" || row.billingStatus !== invoiceStatus)
      ) {
        return false
      }
      if (vendor && !(row.vendor ?? "").toLowerCase().includes(vendor.toLowerCase())) return false
      return true
    })
  }, [rows, mode, categoryId, from, to, invoiceStatus, vendor])

  const sorted = useMemo(() => {
    if (!grouped) return filtered
    return [...filtered].sort((a, b) => {
      const code = (a.categoryCode ?? 999) - (b.categoryCode ?? 999)
      if (code !== 0) return code
      return (a.date ?? "").localeCompare(b.date ?? "")
    })
  }, [filtered, grouped])

  const columns = useMemo<LegacyColumnDef<SheetRow>[]>(
    () => [
      {
        id: "index",
        header: "#",
        cell: ({ row }) => row.index + 1,
      },
      { accessorKey: "date", header: "Date" },
      { accessorKey: "vendor", header: "Vendor" },
      { accessorKey: "description", header: "Description" },
      { id: "category", header: "Category" },
      { id: "amount", header: "Amount" },
      { id: "receipt", header: "Receipt" },
      { id: "invoiceNumber", header: "Invoice #" },
      { id: "invoice", header: "Invoice" },
      { id: "invoiceStatus", header: "Invoice status" },
    ],
    [],
  )

  const table = useLegacyTable({
    data: sorted,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: true,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
  })

  const modelRows = table.getRowModel().rows
  // TanStack Virtual returns functions the React Compiler cannot memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: modelRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (grouped ? 92 : 56),
    overscan: 16,
  })

  const grand = sumCents(filtered.map((row) => row.amount))
  const selectedIds = Object.entries(rowSelection)
    .filter(([, selected]) => selected)
    .map(([id]) => id)
  const gridClass = invoiceTracking
    ? "grid-cols-[28px_36px_96px_140px_minmax(0,1fr)_180px_96px_72px_110px_120px_110px]"
    : "grid-cols-[36px_96px_140px_minmax(0,1fr)_180px_96px_72px]"

  async function saveAmount(row: SheetRow, value: string) {
    const result = await updateExpenseFields({
      projectId,
      expenseId: row.id,
      amount: value,
    })
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  async function saveCategory(row: SheetRow, value: string) {
    const result = await updateExpenseFields({
      projectId,
      expenseId: row.id,
      categoryId: value ? Number(value) : null,
    })
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  async function saveInvoice(ids: string[], number: string) {
    const result =
      ids.length === 1
        ? await assignInvoiceNumber({
            projectId,
            expenseId: ids[0],
            invoiceNumber: number,
          })
        : await linkExpensesToInvoice({
            projectId,
            expenseIds: ids,
            invoiceNumber: number,
          })
    if (result.error) toast.error(result.error)
    else {
      toast.success(number ? "Invoice number saved" : "Invoice number cleared")
      setRowSelection({})
      router.refresh()
    }
  }

  async function saveBilling(row: SheetRow, status: "unpaid" | "paid" | "partial") {
    const result = await setExpenseBillingStatus({
      projectId,
      expenseId: row.id,
      status,
    })
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  const groupBreaks = new Set<string>()
  if (grouped) {
    let previous: number | null = null
    for (const row of modelRows) {
      const code = row.original.categoryCode
      if (code !== previous) {
        groupBreaks.add(row.id)
        previous = code
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs">
          Category
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">All</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {formatCategory(category.code, category.name)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs">
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" />
        </label>
        <label className="grid gap-1 text-xs">
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" />
        </label>
        {invoiceTracking ? (
          <label className="grid gap-1 text-xs">
            Invoice status
            <select value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value)} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
              <option value="">All</option>
            <option value="not_invoiced">Not invoiced</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            </select>
          </label>
        ) : null}
        <label className="grid gap-1 text-xs">
          Vendor
          <input value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Search" className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={grouped} onChange={(event) => setGrouped(event.target.checked)} />
          Group by category
        </label>
      </div>

      {invoiceTracking && selectedIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          <span>{selectedIds.length} selected</span>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const number = window.prompt("Invoice number")
              if (number) void saveInvoice(selectedIds, number)
            }}
          >
            Set invoice number
          </Button>
          <select
            defaultValue=""
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            onChange={(event) => {
              if (event.target.value) void saveInvoice(selectedIds, event.target.value)
              event.target.value = ""
            }}
          >
            <option value="">Add to existing invoice</option>
            {invoices.map((invoice) => (
              <option key={invoice.id} value={invoice.invoiceNumber}>
                {invoice.invoiceNumber}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          {mode === "needs" ? "Every expense is on an invoice." : "No expenses match these filters."}
        </p>
      ) : (
        <>
        <ul className="grid gap-3 md:hidden">
          {sorted.map((item) => (
            <li key={item.id} className="grid gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => setPreview(item)} className="h-14 w-14 shrink-0 overflow-hidden rounded border border-border">
                  {item.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-[10px]">File</span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.vendor || "Unknown vendor"}</p>
                  <p className="text-sm text-muted-foreground">{item.date || "No date"}</p>
                  {item.description ? (
                    <p className="line-clamp-2 text-sm leading-snug break-words">
                      <span className="sr-only">Description: </span>
                      {item.description}
                    </p>
                  ) : null}
                  <p className="text-sm tabular-nums">{formatMoney(item.amount)}</p>
                </div>
                {invoiceTracking ? (
                  <input
                    type="checkbox"
                    checked={Boolean(rowSelection[item.id])}
                    onChange={() => {
                      setRowSelection((current) => {
                        const next = { ...current }
                        if (next[item.id]) delete next[item.id]
                        else next[item.id] = true
                        return next
                      })
                    }}
                    aria-label={`Select ${item.vendor ?? "expense"}`}
                    className="mt-1 size-5"
                  />
                ) : null}
              </div>
              <select
                value={item.categoryId ?? ""}
                onChange={(event) => void saveCategory(item, event.target.value)}
                className="h-11 w-full rounded-lg border border-input bg-transparent px-2 text-base"
              >
                <option value="">Choose category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {formatCategory(category.code, category.name)}
                  </option>
                ))}
              </select>
              <label className="grid gap-1 text-xs">
                Amount
                <input
                  key={`${item.id}-${item.amount}-mobile`}
                  defaultValue={formatMoney(item.amount).replace("$", "")}
                  onBlur={(event) => void saveAmount(item, event.target.value)}
                  inputMode="decimal"
                  className="h-11 rounded-lg border border-input bg-transparent px-2 text-base tabular-nums"
                />
              </label>
              {invoiceTracking ? (
                <div className="grid gap-2">
                  <label className="grid gap-1 text-xs">
                    Invoice #
                    <input
                      key={`${item.id}-${item.invoiceNumber ?? ""}-mobile`}
                      defaultValue={item.invoiceNumber ?? ""}
                      onBlur={(event) => void saveInvoice([item.id], event.target.value)}
                      className="h-11 rounded-lg border border-input bg-transparent px-2 text-base"
                    />
                  </label>
                  {item.invoiceId && item.hasInvoiceFile ? (
                    <a href={`/i/${item.invoiceId}`} target="_blank" rel="noreferrer" className="text-sm underline">
                      View invoice
                    </a>
                  ) : item.invoiceId ? (
                    <form action={uploadInvoiceFile} className="grid gap-1 text-xs">
                      Upload invoice
                      <input type="hidden" name="invoiceId" value={item.invoiceId} />
                      <input type="hidden" name="projectId" value={projectId} />
                      <input
                        name="file"
                        type="file"
                        accept="image/*,application/pdf"
                        className="text-sm"
                        onChange={(event) => {
                          if (event.target.files?.length) event.currentTarget.form?.requestSubmit()
                        }}
                      />
                    </form>
                  ) : null}
                  {item.invoiceId ? (
                    <select
                      value={item.billingStatus}
                      onChange={(event) =>
                        void saveBilling(item, event.target.value as "unpaid" | "paid" | "partial")
                      }
                      className="h-11 rounded-lg border border-input bg-transparent px-2 text-base"
                    >
                      <option value="unpaid">Unpaid</option>
                      <option value="paid">Paid</option>
                      <option value="partial">Partial</option>
                    </select>
                  ) : (
                    <StatusBadge kind="invoice" status="not_invoiced" />
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="hidden min-h-0 overflow-hidden rounded-xl ring-1 ring-foreground/10 md:block">
          <div className={`grid ${gridClass} gap-2 border-b border-border bg-card px-2 py-2 text-xs font-medium sticky top-0`}>
            {invoiceTracking ? <span /> : null}
            <span>#</span>
            <span>Date</span>
            <span>Vendor</span>
            <span>Description</span>
            <span>Category</span>
            <span>Amount</span>
            <span>Receipt</span>
            {invoiceTracking ? (
              <>
                <span>Invoice #</span>
                <span>Invoice view</span>
                <span>Status</span>
              </>
            ) : null}
          </div>
          <div ref={parentRef} className="h-[min(70vh,820px)] overflow-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = modelRows[virtualRow.index]
                const item = row.original
                const showGroup = groupBreaks.has(item.id)
                return (
                  <div
                    key={item.id}
                    className="absolute right-0 left-0 border-b border-border/70"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {showGroup ? (
                      <div className="bg-muted px-2 py-1 text-xs font-medium">
                        {item.categoryCode && item.categoryName
                          ? formatCategory(item.categoryCode, item.categoryName)
                          : "Uncategorized"}
                        {" · "}
                        {formatMoney(
                          centsToMoney(
                            sumCents(
                              sorted
                                .filter((candidate) => candidate.categoryId === item.categoryId)
                                .map((candidate) => candidate.amount),
                            ),
                          ),
                        )}
                      </div>
                    ) : null}
                    <div className={`grid ${gridClass} items-center gap-2 px-2 py-1 text-sm`}>
                      {invoiceTracking ? (
                        <input
                          type="checkbox"
                          checked={row.getIsSelected()}
                          onChange={row.getToggleSelectedHandler()}
                          aria-label={`Select ${item.vendor ?? "expense"}`}
                        />
                      ) : null}
                      {row.getVisibleCells().slice(0, 4).map((cell) => (
                        <div key={cell.id} className="truncate">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                      ))}
                      <select
                        value={item.categoryId ?? ""}
                        onChange={(event) => void saveCategory(item, event.target.value)}
                        className="h-8 truncate rounded-lg border border-input bg-transparent px-1 text-xs"
                      >
                        <option value="">Choose</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {formatCategory(category.code, category.name)}
                          </option>
                        ))}
                      </select>
                      <input
                        key={`${item.id}-${item.amount}`}
                        defaultValue={formatMoney(item.amount).replace("$", "")}
                        onBlur={(event) => void saveAmount(item, event.target.value)}
                        className="h-8 rounded-lg border border-input bg-transparent px-2 text-right text-sm tabular-nums"
                      />
                      <button type="button" onClick={() => setPreview(item)} className="h-10 w-10 overflow-hidden rounded border border-border">
                        {item.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.thumbUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[10px]">File</span>
                        )}
                      </button>
                      {invoiceTracking ? (
                        <>
                          <input
                            key={`${item.id}-${item.invoiceNumber ?? ""}`}
                            defaultValue={item.invoiceNumber ?? ""}
                            onBlur={(event) => void saveInvoice([item.id], event.target.value)}
                            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                          />
                          {item.invoiceId && item.hasInvoiceFile ? (
                            <a href={`/i/${item.invoiceId}`} target="_blank" rel="noreferrer" className="text-xs underline">
                              View
                            </a>
                          ) : item.invoiceId ? (
                            <form action={uploadInvoiceFile} className="flex items-center gap-1">
                              <input type="hidden" name="invoiceId" value={item.invoiceId} />
                              <input type="hidden" name="projectId" value={projectId} />
                              <input
                                name="file"
                                type="file"
                                accept="image/*,application/pdf"
                                aria-label={`Upload invoice ${item.invoiceNumber ?? ""}`}
                                className="w-full text-[10px]"
                                onChange={(event) => {
                                  if (event.target.files?.length) event.currentTarget.form?.requestSubmit()
                                }}
                              />
                            </form>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                          {item.invoiceId ? (
                            <select
                              value={item.billingStatus}
                              onChange={(event) =>
                                void saveBilling(item, event.target.value as "unpaid" | "paid" | "partial")
                              }
                              className="h-8 rounded-lg border border-input bg-transparent px-1 text-xs"
                            >
                              <option value="unpaid">Unpaid</option>
                              <option value="paid">Paid</option>
                              <option value="partial">Partial</option>
                            </select>
                          ) : (
                            <StatusBadge kind="invoice" status="not_invoiced" />
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        </>
      )}

      <div className="flex flex-wrap gap-6 text-sm">
        <p>Rows {filtered.length}</p>
        <p className="font-medium tabular-nums">Total {formatMoney(centsToMoney(grand))}</p>
        {receivedCents != null ? (
          <>
            <p className="tabular-nums">Money received {formatMoney(centsToMoney(receivedCents))}</p>
            <p className={`font-medium tabular-nums ${grand - receivedCents > 0 ? "text-red-700" : ""}`}>
              Balance left {formatMoney(centsToMoney(grand - receivedCents))}
            </p>
          </>
        ) : null}
      </div>

      {preview ? (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/50 p-4" onClick={() => setPreview(null)}>
          <div className="max-h-[90vh] max-w-3xl overflow-auto rounded-xl bg-card p-4" onClick={(event) => event.stopPropagation()}>
            {preview.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.thumbUrl} alt="Receipt" className="max-h-[70vh] w-full object-contain" />
            ) : (
              <p>Open the file to view this receipt.</p>
            )}
            <a href={`/r/${preview.id}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm underline">
              Open full size
            </a>
          </div>
        </div>
      ) : null}

    </div>
  )
}
