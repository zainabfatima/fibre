"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { assignInvoiceNumber, clearDuplicate, confirmReturn, deleteExpense, setExpenseBillingStatus, updateExpenseFields } from "@/app/actions/expenses"
import { ReceiptFileActions } from "@/components/receipt-pdf-actions"
import { ReceiptRecrop } from "@/components/receipt-recrop"
import { ReceiptRetake } from "@/components/receipt-retake"
import { uploadInvoiceFile } from "@/app/actions/invoices"
import { CategoryBudgetHeading } from "@/components/category-budget-heading"
import { DescriptionColumnSearch, useExpenseSearch } from "@/components/expense-amount-search"
import { StatusBadge } from "@/components/status-badge"
import type { SheetRow } from "@/components/expense-sheet"
import { focusAmountField, ReturnConfirmDialog, ReturnNotice } from "@/components/return-confirm"
import { formatCategory } from "@/lib/format"
import { duplicatePartners, isPossibleDuplicate } from "@/lib/duplicates"
import { centsToMoney, expenseAmountInputProps, formatMoney, moneyToCents, needsReturnConfirmation, parseMoneyInput, returnAmountClass, sumCents, amountOverBudget } from "@/lib/money"
import { EDITED_DESCRIPTION_MAX_CHARS } from "@/lib/simple-description"
import { useZainab } from "@/components/view-mode"

type CategoryOption = { id: number; code: number; name: string; budget: string | number }

export function CategorySheets({
  projectId,
  categories,
  rows,
  duplicateRows,
  invoiceTracking,
  mode,
  readOnly = false,
  columns = "all",
}: {
  projectId: string
  categories: CategoryOption[]
  rows: SheetRow[]
  duplicateRows?: SheetRow[]
  invoiceTracking: boolean
  mode: "all" | "needs"
  readOnly?: boolean
  /** Client Expenses tab shows Date, Description, and Amount only. */
  columns?: "all" | "brief"
}) {
  const router = useRouter()
  const [preview, setPreview] = useState<SheetRow | null>(null)
  const [retake, setRetake] = useState<SheetRow | null>(null)
  const [cropping, setCropping] = useState(false)
  const [returnPrompt, setReturnPrompt] = useState<{ row: SheetRow; amount: string } | null>(null)
  const [amountReset, setAmountReset] = useState(0)
  const [clearedDuplicateIds, setClearedDuplicateIds] = useState<string[]>([])
  const shownRows = withConfirmed(rows, clearedDuplicateIds)
  const matchRows = withConfirmed(duplicateRows ?? rows, clearedDuplicateIds)
  const scoped = shownRows.filter((row) => mode !== "needs" || row.invoiceStatus === "not_invoiced")
  const sections = categories.map((category) => ({
    category,
    rows: scoped.filter((row) => row.categoryId === category.id),
  }))
  const uncategorized = scoped.filter((row) => row.categoryId == null)
  const shown = mode === "all" ? sections : sections.filter((section) => section.rows.length > 0)
  const search = useExpenseSearch()
  const matchIds = useMemo(() => search?.matchIds ?? [], [search?.matchIds])
  const activeIndex = search?.activeIndex ?? 0
  const searchQuery = search?.query ?? ""
  const descriptionQuery = search?.descriptionQuery ?? ""
  const searchKey = `${searchQuery}\n${descriptionQuery}`
  const seenQuery = useRef(searchKey)

  useEffect(() => {
    const searching = Boolean(searchQuery.trim() || descriptionQuery.trim())
    if (!searching || matchIds.length === 0) {
      seenQuery.current = searchKey
      return
    }
    const id = matchIds[activeIndex]
    if (!id) return
    const delay = seenQuery.current === searchKey ? 0 : 200
    seenQuery.current = searchKey
    const timer = window.setTimeout(() => {
      const nodes = document.querySelectorAll<HTMLElement>(`[data-expense-id="${CSS.escape(id)}"]`)
      const visible = Array.from(nodes).find((node) => node.getClientRects().length > 0)
      visible?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, delay)
    return () => window.clearTimeout(timer)
  }, [searchKey, searchQuery, descriptionQuery, matchIds, activeIndex])

  async function persistAmount(row: SheetRow, amount: string, success: string) {
    const result = await updateExpenseFields({ projectId, expenseId: row.id, amount })
    if (result.error) toast.error(result.error)
    else {
      toast.success(success)
      router.refresh()
    }
    return result.error == null
  }

  async function saveAmount(row: SheetRow, value: string) {
    const cents = parseMoneyInput(value)
    if (cents == null) {
      toast.error("Enter an amount like 125.00 or -377.20")
      setAmountReset((current) => current + 1)
      return
    }
    if (cents === moneyToCents(row.amount)) return
    const amount = centsToMoney(cents)
    if (cents < 0 && !row.returnConfirmed) {
      setReturnPrompt({ row, amount })
      return
    }
    const saved = await persistAmount(row, amount, "Amount saved")
    if (!saved) setAmountReset((current) => current + 1)
  }

  async function confirmStoredReturn(row: SheetRow, amount?: string) {
    const result = await confirmReturn(projectId, row.id, amount)
    if (result.error) toast.error(result.error)
    else {
      toast.success("Marked as a return")
      setReturnPrompt(null)
      router.refresh()
    }
  }

  function declineReturn(row: SheetRow, focus: boolean) {
    setReturnPrompt(null)
    if (!focus) return
    toast.message("The minus sign stays. Edit the amount if this is a regular charge.")
    focusAmountField(row.id)
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

  async function saveReimbursement(row: SheetRow, reimbursement: boolean) {
    const result = await updateExpenseFields({ projectId, expenseId: row.id, reimbursement })
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  async function saveReimbursementNote(row: SheetRow, reimbursementName: string) {
    const result = await updateExpenseFields({ projectId, expenseId: row.id, reimbursementName })
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  async function saveQuickBooks(row: SheetRow, qbStatus: boolean) {
    const result = await updateExpenseFields({ projectId, expenseId: row.id, qbStatus })
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  async function saveDescription(row: SheetRow, description: string) {
    const result = await updateExpenseFields({ projectId, expenseId: row.id, description })
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  async function confirmNotDuplicate(row: SheetRow) {
    setClearedDuplicateIds((current) => (current.includes(row.id) ? current : [...current, row.id]))
    const result = await clearDuplicate(projectId, row.id)
    if (result.error) {
      setClearedDuplicateIds((current) => current.filter((id) => id !== row.id))
      toast.error(result.error)
    } else {
      toast.success("Marked as not a duplicate")
    }
    router.refresh()
  }

  async function removeReceipt(row: SheetRow) {
    const label = row.vendor?.trim() || "this receipt"
    if (!window.confirm(`Delete ${label}?`)) return
    const result = await deleteExpense(projectId, row.id)
    if (result.error) toast.error(result.error)
    else router.refresh()
  }

  return (
    <div className={`flex flex-col gap-1 pb-2 sm:gap-4 ${columns === "brief" ? "px-4 sm:px-6" : "px-3 sm:px-4"}`}>
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
          onRetake={setRetake}
          onAmount={saveAmount}
          onInvoice={saveInvoice}
          onStatus={saveStatus}
          onCategory={saveCategory}
          onReimbursement={saveReimbursement}
          onReimbursementNote={saveReimbursementNote}
          onQuickBooks={saveQuickBooks}
          onDescription={saveDescription}
          onDelete={removeReceipt}
          onConfirmDuplicate={confirmNotDuplicate}
          onConfirmReturn={(row) => void confirmStoredReturn(row, row.amount)}
          onCorrectReturn={(row) => declineReturn(row, true)}
          amountReset={amountReset}
          allRows={matchRows}
          readOnly={readOnly}
          columns={columns}
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
          onRetake={setRetake}
          onAmount={saveAmount}
          onInvoice={saveInvoice}
          onStatus={saveStatus}
          onCategory={saveCategory}
          onReimbursement={saveReimbursement}
          onReimbursementNote={saveReimbursementNote}
          onQuickBooks={saveQuickBooks}
          onDescription={saveDescription}
          onDelete={removeReceipt}
          onConfirmDuplicate={confirmNotDuplicate}
          onConfirmReturn={(row) => void confirmStoredReturn(row, row.amount)}
          onCorrectReturn={(row) => declineReturn(row, true)}
          amountReset={amountReset}
          allRows={matchRows}
          readOnly={readOnly}
          columns={columns}
        />
      ) : null}
      {preview ? (
        <div className="fixed inset-0 z-40 grid place-items-end bg-black/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:place-items-center sm:p-4" onClick={() => setPreview(null)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl bg-card p-4" onClick={(event) => event.stopPropagation()}>
            {preview.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.thumbUrl} alt="Receipt" className="max-h-[70vh] w-full object-contain" />
            ) : preview.hasReceipt !== false ? (
              <iframe title="Receipt" src={`/r/${preview.id}`} className="h-[70vh] min-h-80 w-full rounded-lg bg-white" />
            ) : (
              <p>Open the file to view this receipt.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {!readOnly && preview.hasReceipt !== false ? (
                <button type="button" onClick={() => setCropping(true)} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
                  Crop
                </button>
              ) : null}
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => {
                    setRetake(preview)
                    setPreview(null)
                  }}
                  className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium"
                >
                  Retake picture
                </button>
              ) : null}
              {!readOnly && preview.hasReceipt !== false ? <ReceiptFileActions expenseId={preview.id} /> : null}
              <a href={`/r/${preview.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium">
                Open full size
              </a>
              <button type="button" onClick={() => setPreview(null)} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-4 text-sm">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {retake && !readOnly ? (
        <ReceiptRetake
          projectId={projectId}
          expenseId={retake.id}
          categoryId={retake.categoryId}
          onClose={() => setRetake(null)}
          onSaved={() => {
            setRetake(null)
            setPreview(null)
            router.refresh()
          }}
        />
      ) : null}
      {cropping && preview && !readOnly ? (
        <ReceiptRecrop
          projectId={projectId}
          expenseId={preview.id}
          src={`/r/${preview.id}`}
          onClose={() => setCropping(false)}
          onSaved={() => {
            setCropping(false)
            setPreview(null)
            router.refresh()
          }}
        />
      ) : null}
      {returnPrompt ? (
        <ReturnConfirmDialog
          amount={returnPrompt.amount}
          onConfirm={() => void confirmStoredReturn(returnPrompt.row, returnPrompt.amount)}
          onCorrect={() => declineReturn(returnPrompt.row, true)}
          onDismiss={() => declineReturn(returnPrompt.row, false)}
        />
      ) : null}
    </div>
  )
}

function AmountInput({
  row,
  highlighted,
  onAmount,
  className,
  readOnly,
  resetKey,
}: {
  row: SheetRow
  highlighted: boolean
  onAmount: (row: SheetRow, value: string) => void
  className: string
  readOnly: boolean
  resetKey: number
}) {
  const token = `${row.amount}:${resetKey}`
  const [seen, setSeen] = useState(token)
  const [draft, setDraft] = useState<string | null>(null)
  if (seen !== token) {
    setSeen(token)
    setDraft(null)
  }
  const shown = draft ?? row.amount
  const signed = centsToMoney(moneyToCents(row.amount))
  const search = useExpenseSearch()
  const paintAmount = highlighted && Boolean(search?.query.trim())
  if (readOnly) {
    return <p className={`text-right font-semibold tabular-nums ${returnAmountClass(signed)}`}>{signed}</p>
  }
  return (
    <input
      {...expenseAmountInputProps}
      data-amount-for={row.id}
      key={token}
      defaultValue={signed}
      aria-label={`Amount for ${row.vendor || "receipt"}`}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => onAmount(row, event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return
        event.preventDefault()
        event.currentTarget.blur()
      }}
      className={`${className} ${returnAmountClass(shown)} ${paintAmount ? "border-primary bg-amber-200 font-semibold dark:bg-amber-900" : "border-input bg-transparent"}`}
    />
  )
}

function DescriptionInput({
  row,
  readOnly,
  onDescription,
  className,
}: {
  row: SheetRow
  readOnly: boolean
  onDescription: (row: SheetRow, description: string) => void
  className?: string
}) {
  const matchClass = useDescriptionMatchClass(row.id)
  if (readOnly) {
    return (
      <span className={`block max-w-48 truncate ${matchClass}`} title={row.description ?? undefined}>
        {row.description || "—"}
      </span>
    )
  }
  return (
    <input
      key={`${row.id}:${row.description ?? ""}`}
      defaultValue={row.description ?? ""}
      maxLength={EDITED_DESCRIPTION_MAX_CHARS}
      placeholder="What was bought"
      aria-label={`Description for ${row.vendor || "receipt"}`}
      onBlur={(event) => {
        const next = event.target.value.replace(/\s+/g, " ").trim()
        if (next === (row.description ?? "")) return
        onDescription(row, next)
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return
        event.preventDefault()
        event.currentTarget.blur()
      }}
      className={`${className ?? "h-9 w-full min-w-36 rounded-lg border px-2 text-sm"} border-input ${matchClass || "bg-transparent"}`}
    />
  )
}

function useDescriptionMatchClass(id: string) {
  const search = useExpenseSearch()
  const terms = search?.descriptionQuery.trim()
  if (!terms || !search?.matchIds.includes(id)) return ""
  const active = search.matchIds[search.activeIndex] === id
  return active
    ? "rounded bg-amber-200 ring-2 ring-primary dark:bg-amber-900"
    : "rounded bg-amber-100 dark:bg-amber-950"
}

function DescriptionReadout({ row, className }: { row: SheetRow; className?: string }) {
  const matchClass = useDescriptionMatchClass(row.id)
  return <span className={`${className ?? ""} ${matchClass}`}>{row.description || "—"}</span>
}

function YesNoSelect({
  value,
  label,
  onChange,
}: {
  value: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <select
      aria-label={label}
      value={value ? "yes" : "no"}
      onChange={(event) => onChange(event.target.value === "yes")}
      className="h-9 rounded-lg border border-input bg-transparent px-2 text-sm"
    >
      <option value="no">No</option>
      <option value="yes">Yes</option>
    </select>
  )
}

function ReimbursementFields({
  row,
  onFlag,
  onNote,
}: {
  row: SheetRow
  onFlag: (row: SheetRow, reimbursement: boolean) => void
  onNote: (row: SheetRow, note: string) => void
}) {
  const who = row.vendor || "receipt"
  return (
    <div className="grid min-w-36 gap-1">
      <YesNoSelect
        value={Boolean(row.reimbursement)}
        label={`Reimbursement for ${who}`}
        onChange={(next) => onFlag(row, next)}
      />
      <input
        key={`${row.id}:${row.reimbursementNote ?? ""}`}
        defaultValue={row.reimbursementNote ?? ""}
        maxLength={80}
        placeholder="Who to reimburse"
        aria-label={`Reimbursement note for ${who}`}
        onBlur={(event) => {
          const next = event.target.value.trim()
          if (next === (row.reimbursementNote ?? "")) return
          onNote(row, next)
        }}
        className="h-9 w-full rounded-lg border border-amber-300 bg-white px-2 text-sm"
      />
    </div>
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
  onRetake,
  onAmount,
  onInvoice,
  onStatus,
  onCategory,
  onReimbursement,
  onReimbursementNote,
  onQuickBooks,
  onDescription,
  onDelete,
  onConfirmDuplicate,
  onConfirmReturn,
  onCorrectReturn,
  amountReset,
  allRows,
  readOnly,
  columns,
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
  onRetake: (row: SheetRow) => void
  onAmount: (row: SheetRow, value: string) => void
  onInvoice: (row: SheetRow, number: string) => void
  onStatus: (row: SheetRow, status: "unpaid" | "paid" | "partial") => void
  onCategory: (row: SheetRow, categoryId: number) => void
  onReimbursement: (row: SheetRow, reimbursement: boolean) => void
  onReimbursementNote: (row: SheetRow, note: string) => void
  onQuickBooks: (row: SheetRow, inQuickBooks: boolean) => void
  onDescription: (row: SheetRow, description: string) => void
  onDelete: (row: SheetRow) => void
  onConfirmDuplicate: (row: SheetRow) => void
  onConfirmReturn: (row: SheetRow) => void
  onCorrectReturn: (row: SheetRow) => void
  amountReset: number
  allRows: SheetRow[]
  readOnly: boolean
  columns: "all" | "brief"
}) {
  const brief = columns === "brief"
  const tableColumns = brief ? 3 : 5 + (readOnly ? 0 : 4) + (invoiceTracking ? 3 : 0)
  const trailingColumns = brief ? 0 : (readOnly ? 1 : 5) + (invoiceTracking ? 3 : 0)
  const spentCents = sumCents(rows.map((row) => row.amount))
  const total = formatMoney(centsToMoney(spentCents))
  const budgetText = budget == null ? null : formatMoney(budget)
  const overCents = amountOverBudget(budget, spentCents)
  const overBy = overCents == null ? null : formatMoney(centsToMoney(overCents))
  const overClass = overBy ? "border-l-red-600 bg-red-50 ring-red-300 dark:bg-red-950/30" : "border-l-primary bg-card ring-foreground/10"
  if (rows.length === 0) {
    return (
      <>
        <div className="border-b border-border/70 px-1 py-2.5 md:hidden">
          <div className="flex items-start justify-between gap-3">
            <CategoryBudgetHeading title={title} budget={budgetText} spent={total} overBy={overBy} compact />
          </div>
          <CategoryPdfLink projectId={projectId} categoryKey={categoryKey} title={title} needs={needs} fullWidth />
        </div>
        <section className={`hidden overflow-hidden rounded-xl border-l-4 ring-1 md:block ${overClass}`}>
          <header className={`flex items-start justify-between gap-3 border-b px-3 py-2 ${overBy ? "border-red-200 bg-red-100" : "border-border bg-muted"}`}>
            <CategoryBudgetHeading title={title} budget={budgetText} spent={total} overBy={overBy} />
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
    <section className={`mt-2 overflow-hidden rounded-xl border-l-4 ring-1 md:mt-0 ${overClass}`}>
      <header className={`flex items-start justify-between gap-3 border-b px-3 py-3 ${overBy ? "border-red-200 bg-red-100" : "border-border bg-muted"}`}>
        <CategoryBudgetHeading title={title} budget={budgetText} spent={total} overBy={overBy} />
      </header>
      <>
        <div className="grid md:hidden">
          {brief ? (
            <div className="grid grid-cols-[7.75rem_minmax(0,1fr)_auto] gap-x-5 border-b border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold">
              <span className="text-sky-800">Date</span>
              <label className="grid min-w-0 gap-1">
                <span className="text-orange-800">Description</span>
                <DescriptionColumnSearch />
              </label>
              <span className="text-right text-emerald-800">Amount</span>
            </div>
          ) : null}
          {rows.map((row, index) => (
            <article
              key={row.id}
              data-expense-id={row.id}
              className={`scroll-mt-48 border-b border-border/70 p-3 ${brief && !matchIds.includes(row.id) ? (index % 2 === 0 ? "bg-amber-50" : "bg-sky-50") : ""} ${rowSurface(!readOnly && (isDuplicatePair(row, allRows) || needsReturnConfirmation(row.amount, row.returnConfirmed)), matchIds.includes(row.id), matchIds[activeIndex] === row.id)}`}
            >
              {brief ? (
                <div className="grid grid-cols-[7.75rem_minmax(0,1fr)_auto] items-start gap-x-5 text-sm">
                  <p>{row.date || "No date"}</p>
                  <DescriptionReadout row={row} className="min-w-0 leading-snug break-words whitespace-normal" />
                  <AmountInput
                    row={row}
                    highlighted={matchIds.includes(row.id)}
                    onAmount={onAmount}
                    readOnly={readOnly}
                    resetKey={amountReset}
                    className="text-right text-base font-semibold"
                  />
                </div>
              ) : (
              <>
              {!readOnly && isDuplicatePair(row, allRows) ? (
                <DuplicateNotice
                  others={pairedReceipts(row, allRows)}
                  onConfirm={() => onConfirmDuplicate(row)}
                  onPreview={onPreview}
                  onDelete={onDelete}
                />
              ) : null}
              {!readOnly && needsReturnConfirmation(row.amount, row.returnConfirmed) ? (
                <ReturnNotice
                  amount={row.amount}
                  onConfirm={() => onConfirmReturn(row)}
                  onCorrect={() => onCorrectReturn(row)}
                />
              ) : null}
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
                      readOnly={readOnly}
                      resetKey={amountReset}
                      className="h-11 w-40 shrink-0 rounded-lg border px-2 text-right text-base font-semibold tabular-nums"
                    />
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{row.date || "No date"}</p>
                  {readOnly ? (
                    row.description ? (
                      <p className="mt-1 line-clamp-2 text-sm leading-snug break-words">
                        <span className="sr-only">Description: </span>
                        <DescriptionReadout row={row} />
                      </p>
                    ) : null
                  ) : (
                    <label className="mt-2 grid gap-1 text-sm">
                      <span className="text-muted-foreground">Description</span>
                      <DescriptionInput row={row} readOnly={false} onDescription={onDescription} />
                    </label>
                  )}
                  {invoiceTracking ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm">{row.invoiceNumber ? `Invoice ${row.invoiceNumber}` : "No invoice"}</span>
                      <StatusBadge kind="invoice" status={row.invoiceId ? row.billingStatus : "not_invoiced"} />
                    </div>
                  ) : null}
                  {readOnly ? null : (
                    <div className="mt-3 grid gap-2 rounded-lg bg-amber-50 p-2 text-amber-950">
                      <p className="text-xs font-medium">Reimbursement</p>
                      <ReimbursementFields row={row} onFlag={onReimbursement} onNote={onReimbursementNote} />
                      <label className="grid gap-1 text-xs font-medium">
                        QuickBooks
                        <YesNoSelect
                          value={Boolean(row.qbStatus)}
                          label={`QuickBooks for ${row.vendor || "receipt"}`}
                          onChange={(next) => onQuickBooks(row, next)}
                        />
                      </label>
                    </div>
                  )}
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
                {readOnly ? null : (
                  <button
                    type="button"
                    onClick={() => onRetake(row)}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium"
                  >
                    Retake picture
                  </button>
                )}
                {!readOnly && row.hasReceipt !== false ? (
                  <ReceiptFileActions
                    expenseId={row.id}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input px-3 text-sm font-medium"
                  />
                ) : null}
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
              {readOnly ? null : (
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
                            accept="image/*,.pdf,application/pdf"
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
              )}
              </>
              )}
            </article>
          ))}
          <div className="bg-muted/60 px-3 py-3">
            <p className="text-sm font-semibold tabular-nums">
              {budgetText ? `Budget ${budgetText} · ` : null}
              <span className={returnAmountClass(centsToMoney(spentCents))}>Spent {total}</span>
              {overBy ? <span className="mt-1 block font-medium text-red-700">Over budget by {overBy}</span> : null}
            </p>
            <CategoryPdfLink projectId={projectId} categoryKey={categoryKey} title={title} needs={needs} fullWidth />
          </div>
        </div>
        <div className={brief ? "hidden md:block" : "hidden overflow-x-auto md:block"}>
          <table className={`w-full ${brief ? "table-fixed text-base" : "min-w-[1400px] text-sm"}`}>
            {brief ? (
              <colgroup>
                <col className="w-44" />
                <col />
                <col className="w-40" />
              </colgroup>
            ) : null}
            <thead>
              <tr className={`text-left ${brief ? "border-b border-sky-200 bg-sky-50 text-sm" : "border-b border-border text-xs"}`}>
                <th className={brief ? "px-4 py-3 pr-8 font-bold text-sky-800" : "px-3 py-2 font-medium"}>Date</th>
                {brief ? null : <th className="px-3 py-2 font-medium">Vendor</th>}
                <th className={brief ? "px-4 py-3 font-bold text-orange-800" : "px-3 py-2 font-medium"}>
                  <label className="grid gap-1">
                    <span>Description</span>
                    <DescriptionColumnSearch />
                  </label>
                </th>
                <th className={brief ? "px-4 py-3 text-right font-bold text-emerald-800" : "px-3 py-2 font-medium"}>Amount</th>
                {brief ? null : <th className="px-3 py-2 font-medium">Receipt</th>}
                {brief || readOnly ? null : (
                  <>
                    <th className="px-3 py-2 font-medium">Change category</th>
                    <th className="px-3 py-2 font-medium">Delete</th>
                  </>
                )}
                {brief || !invoiceTracking ? null : (
                  <>
                    <th className="px-3 py-2 font-medium">Invoice #</th>
                    <th className="px-3 py-2 font-medium">Invoice status</th>
                    <th className="px-3 py-2 font-medium">Invoice view</th>
                  </>
                )}
                {brief || readOnly ? null : (
                  <>
                    <th className="bg-amber-50 px-3 py-2 font-medium text-amber-950">Reimbursement</th>
                    <th className="bg-sky-50 px-3 py-2 font-medium text-sky-950">QuickBooks</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <Fragment key={row.id}>
                {isDuplicatePair(row, allRows) && !readOnly ? (
                  <tr className="bg-red-50 dark:bg-red-950/40">
                    <td colSpan={tableColumns} className="px-3 py-2">
                      <DuplicateNotice
                        others={pairedReceipts(row, allRows)}
                        onConfirm={() => onConfirmDuplicate(row)}
                        onPreview={onPreview}
                        onDelete={onDelete}
                      />
                    </td>
                  </tr>
                ) : null}
                {!readOnly && needsReturnConfirmation(row.amount, row.returnConfirmed) ? (
                  <tr className="bg-red-50 dark:bg-red-950/40">
                    <td colSpan={tableColumns} className="px-3 py-2">
                      <ReturnNotice
                        amount={row.amount}
                        onConfirm={() => onConfirmReturn(row)}
                        onCorrect={() => onCorrectReturn(row)}
                      />
                    </td>
                  </tr>
                ) : null}
                <tr
                  data-expense-id={row.id}
                  className={`scroll-mt-48 border-b border-border/70 ${brief && !matchIds.includes(row.id) ? (index % 2 === 0 ? "bg-amber-50" : "bg-sky-50") : ""} ${rowSurface(!readOnly && (isDuplicatePair(row, allRows) || needsReturnConfirmation(row.amount, row.returnConfirmed)), matchIds.includes(row.id), matchIds[activeIndex] === row.id)}`}
                >
                  <td className={brief ? "px-4 py-3 pr-8 align-top whitespace-nowrap" : "px-3 py-2 whitespace-nowrap"}>{row.date || "—"}</td>
                  {brief ? null : <td className="max-w-40 truncate px-3 py-2">{row.vendor || "—"}</td>}
                  <td className={brief ? "min-w-0 px-4 py-3 align-top whitespace-normal" : "px-3 py-2"}>
                    {brief ? (
                      <DescriptionReadout row={row} className="block max-w-xl leading-snug break-words whitespace-normal" />
                    ) : (
                      <DescriptionInput row={row} readOnly={readOnly} onDescription={onDescription} />
                    )}
                  </td>
                  <td className={brief ? "px-4 py-3 align-top text-right whitespace-nowrap" : "px-3 py-2"}>
                    <AmountInput
                      row={row}
                      highlighted={matchIds.includes(row.id)}
                      onAmount={onAmount}
                      readOnly={readOnly}
                      resetKey={amountReset}
                      className="h-9 w-40 rounded-lg border px-2 text-right text-sm tabular-nums"
                    />
                  </td>
                  {brief ? null : <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => onPreview(row)} className="h-12 w-12 overflow-hidden rounded border border-border">
                        {row.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={row.thumbUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[10px]">File</span>
                        )}
                      </button>
                      {readOnly ? null : (
                        <button
                          type="button"
                          onClick={() => onRetake(row)}
                          className="h-9 whitespace-nowrap rounded-lg border border-input px-2 text-sm"
                        >
                          Retake
                        </button>
                      )}
                      {!readOnly && row.hasReceipt !== false ? (
                        <ReceiptFileActions
                          expenseId={row.id}
                          className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-input px-2 text-sm"
                        />
                      ) : null}
                    </div>
                  </td>}
                  {brief || readOnly ? null : (
                    <>
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
                    </>
                  )}
                  {!brief && invoiceTracking ? (
                    readOnly ? (
                      <>
                        <td className="px-3 py-2">{row.invoiceNumber || "—"}</td>
                        <td className="px-3 py-2">
                          <StatusBadge kind="invoice" status={row.invoiceId ? row.billingStatus : "not_invoiced"} />
                        </td>
                        <td className="px-3 py-2">
                          {row.invoiceId && row.hasInvoiceFile ? (
                            <a href={`/i/${row.invoiceId}`} target="_blank" rel="noreferrer" className="underline">
                              View
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </>
                    ) : (
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
                              accept="image/*,.pdf,application/pdf"
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
                    )
                  ) : null}
                  {brief || readOnly ? null : (
                    <>
                      <td className="bg-amber-50 px-3 py-2 align-top text-amber-950">
                        <ReimbursementFields row={row} onFlag={onReimbursement} onNote={onReimbursementNote} />
                      </td>
                      <td className="bg-sky-50 px-3 py-2 align-top">
                        <YesNoSelect
                          value={Boolean(row.qbStatus)}
                          label={`QuickBooks for ${row.vendor || "receipt"}`}
                          onChange={(next) => onQuickBooks(row, next)}
                        />
                      </td>
                    </>
                  )}
                </tr>
                </Fragment>
              ))}
              <tr className={`font-medium ${overBy ? "bg-red-100 text-red-800" : "bg-muted/60"}`}>
                <td className={brief ? "px-4 py-3" : "px-3 py-2"} colSpan={brief ? 2 : 3}>
                  Spent
                  {brief && overBy ? <p className="font-medium text-red-700">Over budget by {overBy}</p> : null}
                  {brief ? <CategoryPdfLink projectId={projectId} categoryKey={categoryKey} title={title} needs={needs} /> : null}
                </td>
                <td className={`${brief ? "px-4 py-3 text-right" : "px-3 py-2"} tabular-nums ${returnAmountClass(centsToMoney(spentCents))}`}>{total}</td>
                {trailingColumns > 0 ? (
                  <td className="px-3 py-2" colSpan={trailingColumns}>
                    {overBy ? <p className="font-medium text-red-700">Over budget by {overBy}</p> : null}
                    <CategoryPdfLink projectId={projectId} categoryKey={categoryKey} title={title} needs={needs} />
                  </td>
                ) : null}
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
  const zainab = useZainab()
  const href = `/api/packet/${projectId}/${categoryKey}${needs ? "?needs=1" : ""}`
  if (!zainab) return null
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

function rowSurface(duplicate: boolean, matched: boolean, active: boolean) {
  if (duplicate) return "bg-red-50 ring-1 ring-inset ring-red-400 dark:bg-red-950/40"
  return expenseHighlight(matched, active)
}

function withConfirmed(list: SheetRow[], clearedIds: string[]) {
  if (clearedIds.length === 0) return list
  const cleared = new Set(clearedIds)
  return list.map((row) =>
    cleared.has(row.id) ? { ...row, duplicateConfirmed: true, duplicateOf: null } : row,
  )
}

function pairedReceipts(row: SheetRow, allRows: SheetRow[]) {
  return duplicatePartners(row, allRows)
}

function isDuplicatePair(row: SheetRow, allRows: SheetRow[]) {
  return isPossibleDuplicate(row, allRows)
}

function showReceiptInList(id: string) {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-expense-id="${CSS.escape(id)}"]`)
  const visible = Array.from(nodes).find((node) => node.getClientRects().length > 0)
  visible?.scrollIntoView({ behavior: "smooth", block: "center" })
}

function DuplicateNotice({
  others,
  onConfirm,
  onPreview,
  onDelete,
}: {
  others: SheetRow[]
  onConfirm: () => void
  onPreview: (row: SheetRow) => void
  onDelete: (row: SheetRow) => void
}) {
  return (
    <div className="mb-3 grid gap-3 rounded-lg bg-red-100 p-3 text-sm text-red-950 dark:bg-red-950 dark:text-red-50 md:mb-0">
      <div>
        <p className="font-medium">Possible duplicate</p>
        <p>
          Another expense on this project has the same amount and date. Compare the receipts, then delete the extra
          one, or confirm this is not a duplicate.
        </p>
      </div>
      {others.length === 0 ? <p>The other copy is no longer in this project.</p> : null}
      {others.map((other) => (
        <OtherReceipt key={other.id} row={other} onPreview={onPreview} onDelete={onDelete} />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onConfirm}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
        >
          Not a duplicate
        </button>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            onChange={(event) => {
              if (event.target.checked) onConfirm()
            }}
            className="size-5"
          />
          Confirmed
        </label>
      </div>
    </div>
  )
}

function OtherReceipt({
  row,
  onPreview,
  onDelete,
}: {
  row: SheetRow
  onPreview: (row: SheetRow) => void
  onDelete: (row: SheetRow) => void
}) {
  const category =
    row.categoryCode != null && row.categoryName
      ? formatCategory(row.categoryCode, row.categoryName)
      : "Uncategorized"
  const when = [row.date, row.receiptTime].filter(Boolean).join(" ")
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 rounded-lg bg-white/80 p-2 text-foreground dark:bg-black/20">
      <button
        type="button"
        onClick={() => onPreview(row)}
        className="grid h-16 w-16 place-items-center overflow-hidden rounded-lg border border-border bg-muted text-[10px]"
      >
        {row.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.thumbUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          "Receipt"
        )}
      </button>
      <div className="min-w-0">
        <p className="font-medium">Other copy</p>
        <p className="break-words">{row.vendor || "Receipt"}</p>
        <p className="text-muted-foreground">
          {when || "No date"}
          {" · "}
          <span className={returnAmountClass(row.amount)}>{formatMoney(row.amount)}</span>
          {" · "}
          {category}
          {row.receiptNumber ? ` · #${row.receiptNumber}` : ""}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPreview(row)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input bg-background px-3 text-sm font-medium"
          >
            View receipt
          </button>
          <button
            type="button"
            onClick={() => showReceiptInList(row.id)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input bg-background px-3 text-sm font-medium"
          >
            Show in list
          </button>
          <button
            type="button"
            onClick={() => onDelete(row)}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-input bg-background px-3 text-sm font-medium text-destructive"
          >
            Delete this copy
          </button>
        </div>
      </div>
    </div>
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
