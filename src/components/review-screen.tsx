"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { clearDuplicate, confirmReturn, deleteExpense, saveSplit, updateExpenseFields } from "@/app/actions/expenses"
import { ReturnConfirmDialog, ReturnNotice } from "@/components/return-confirm"
import { ReceiptPages } from "@/components/receipt-pages"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SIMPLE_DESCRIPTION_MAX_CHARS } from "@/lib/simple-description"
import { formatCategory } from "@/lib/format"
import { centsToMoney, formatMoney, needsReturnConfirmation, parseMoneyInput, sumCents } from "@/lib/money"
import { withZainab } from "@/lib/zainab-path"
import { useZainab } from "@/components/view-mode"

type CategoryOption = { id: number; code: number; name: string }
type Line = { description: string; amount: string; categoryId: number | null }

export function ReviewScreen({
  projectId,
  expenseId,
  queue,
  vendor,
  date,
  amount,
  description,
  receiptNumber,
  paymentMethod,
  categoryId,
  confidence,
  suggestedIds,
  fileUrl,
  fileType,
  pageCount,
  previewUrl,
  notes,
  splitSuggested,
  lineItems,
  duplicate,
  returnConfirmed: returnConfirmedInitial,
  audit,
  categories,
}: {
  projectId: string
  expenseId: string
  queue: string[]
  vendor: string
  date: string
  amount: string
  description: string
  receiptNumber: string
  paymentMethod: string
  categoryId: number | null
  confidence: number | null
  suggestedIds: number[]
  fileUrl: string
  fileType: "image" | "pdf"
  pageCount: number
  previewUrl: string | null
  notes: string | null
  splitSuggested: boolean
  lineItems: Line[]
  duplicate: {
    id: string
    vendor: string | null
    amount: string
    date: string | null
    imageUrl: string | null
  } | null
  returnConfirmed: boolean
  audit: Array<{ field: string; oldValue: string | null; newValue: string | null; at: string }>
  categories: CategoryOption[]
}) {
  const router = useRouter()
  const [fields, setFields] = useState({
    vendor,
    date,
    amount,
    description,
    receiptNumber,
    paymentMethod,
    categoryId,
  })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [zoomExpenseId, setZoomExpenseId] = useState(expenseId)
  if (zoomExpenseId !== expenseId) {
    setZoomExpenseId(expenseId)
    setZoom(1)
    setRotation(0)
  }
  const [query, setQuery] = useState("")
  const [splitOpen, setSplitOpen] = useState(splitSuggested)
  const [splits, setSplits] = useState<Line[]>(
    lineItems.length >= 2
      ? lineItems
      : [
          { description, amount, categoryId },
          { description: "", amount: "", categoryId: null },
        ],
  )
  const [returnConfirmed, setReturnConfirmed] = useState(returnConfirmedInitial)
  const [returnDialog, setReturnDialog] = useState(() => needsReturnConfirmation(amount, returnConfirmedInitial))
  const zainab = useZainab()
  const index = queue.indexOf(expenseId)
  const low = confidence != null && confidence < 0.7
  const filtered = categories.filter((category) =>
    formatCategory(category.code, category.name).toLowerCase().includes(query.toLowerCase()),
  )

  function go(nextId: string | undefined) {
    if (!nextId) {
      router.push(withZainab(`/projects/${projectId}`, zainab))
      return
    }
    router.push(withZainab(`/projects/${projectId}/review?expense=${nextId}`, zainab))
  }

  const returnCents = parseMoneyInput(fields.amount)
  const returnAmount = returnCents != null && returnCents < 0 ? centsToMoney(returnCents) : null
  const needsReturn = returnAmount != null && !returnConfirmed

  async function acceptReturn() {
    if (!returnAmount) return
    const result = await confirmReturn(projectId, expenseId, returnAmount)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Marked as a return")
    setFields((current) => ({ ...current, amount: returnAmount }))
    setReturnConfirmed(true)
    setReturnDialog(false)
    router.refresh()
  }

  async function rejectReturn() {
    if (returnCents == null) return
    const positive = centsToMoney(Math.abs(returnCents))
    const result = await updateExpenseFields({ projectId, expenseId, amount: positive })
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Saved as a charge")
    setFields((current) => ({ ...current, amount: positive }))
    setReturnConfirmed(false)
    setReturnDialog(false)
    router.refresh()
  }

  async function verify() {
    if (needsReturnConfirmation(fields.amount, returnConfirmed)) {
      setReturnDialog(true)
      toast.error("Confirm this return before verifying")
      return
    }
    const result = await updateExpenseFields({
      projectId,
      expenseId,
      vendor: fields.vendor,
      expenseDate: fields.date,
      amount: fields.amount,
      description: fields.description,
      receiptNumber: fields.receiptNumber,
      paymentMethod: fields.paymentMethod,
      categoryId: fields.categoryId,
      verify: true,
    })
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success("Verified")
    go(queue[index + 1])
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      if (event.key === "Enter" && !event.shiftKey) {
        if (returnDialog) return
        event.preventDefault()
        void verify()
      }
      if (!typing && ["1", "2", "3"].includes(event.key)) {
        const id = suggestedIds[Number(event.key) - 1]
        if (id) setFields((current) => ({ ...current, categoryId: id }))
      }
      if (!typing && event.key === "ArrowRight") go(queue[index + 1])
      if (!typing && event.key === "ArrowLeft") go(queue[index - 1])
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  async function saveLines() {
    const result = await saveSplit({
      projectId,
      expenseId,
      total: fields.amount,
      rows: splits.map((line) => ({
        categoryId: line.categoryId,
        amount: line.amount,
        description: line.description,
      })),
    })
    if (result.error) toast.error(result.error)
    else {
      toast.success("Split saved")
      router.refresh()
    }
  }

  return (
    <div className="grid min-w-0 gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
      <div className="min-w-0 overflow-x-auto rounded-xl bg-muted lg:max-h-[80vh] lg:overflow-y-auto">
        <div className="flex flex-wrap gap-2 p-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setZoom((value) => value + 0.25)}>
            Zoom in
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>
            Zoom out
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setRotation((value) => value + 90)}>
            Rotate
          </Button>
        </div>
        <div className="p-3 sm:p-4">
          <ReceiptPages
            src={fileUrl}
            fileType={fileType}
            pageCount={pageCount}
            zoom={zoom}
            rotation={rotation}
          />
        </div>
      </div>

      <div className="grid content-start gap-3">
        <p className="text-sm text-muted-foreground">
          {index + 1} of {queue.length}. Enter verifies and moves on. Keys 1–3 pick a suggestion.
        </p>
        {notes ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{notes}</p> : null}
        {duplicate ? (
          <div className="rounded-xl border border-red-200 p-3">
            <p className="text-sm font-medium">Possible duplicate</p>
            <p className="text-sm text-muted-foreground">
              {duplicate.vendor} · {duplicate.date} · {formatMoney(duplicate.amount)}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="" className="max-h-32 w-full object-contain" />
              ) : (
                <span>This receipt</span>
              )}
              {duplicate.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={duplicate.imageUrl} alt="" className="max-h-32 w-full object-contain" />
              ) : (
                <span>Other receipt</span>
              )}
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  const result = await clearDuplicate(projectId, expenseId)
                  if (result.error) toast.error(result.error)
                  else router.refresh()
                }}
              >
                Not a duplicate
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={async () => {
                  const result = await deleteExpense(projectId, expenseId)
                  if (result.error) toast.error(result.error)
                  else go(queue[index + 1] ?? queue[index - 1])
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        ) : null}
        {needsReturn && returnAmount ? (
          <ReturnNotice amount={returnAmount} onConfirm={() => void acceptReturn()} onCorrect={() => void rejectReturn()} />
        ) : null}
        <Field label="Vendor" value={fields.vendor} low={low} onChange={(vendor) => setFields({ ...fields, vendor })} />
        <Field label="Date" value={fields.date} type="date" low={low} onChange={(date) => setFields({ ...fields, date })} />
        <Field label="Amount" value={fields.amount} low={low} onChange={(amount) => setFields({ ...fields, amount })} />
        <Field
          label="Description"
          value={fields.description}
          maxLength={SIMPLE_DESCRIPTION_MAX_CHARS}
          placeholder="What was bought"
          onChange={(description) => setFields({ ...fields, description })}
        />
        <Field label="Receipt number" value={fields.receiptNumber} onChange={(receiptNumber) => setFields({ ...fields, receiptNumber })} />
        <Field label="Payment method" value={fields.paymentMethod} onChange={(paymentMethod) => setFields({ ...fields, paymentMethod })} />
        <div className="flex flex-wrap gap-2">
          {suggestedIds.map((id, chip) => {
            const category = categories.find((item) => item.id === id)
            if (!category) return null
            return (
              <button
                key={id}
                type="button"
                className={`rounded-full px-3 py-1 text-sm ring-1 ${fields.categoryId === id ? "bg-primary text-primary-foreground" : "ring-border"}`}
                onClick={() => setFields({ ...fields, categoryId: id })}
              >
                {chip + 1}. {formatCategory(category.code, category.name)}
              </button>
            )
          })}
        </div>
        <Label htmlFor="category-search">Category</Label>
        <Input id="category-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search categories" />
        <select
          value={fields.categoryId ?? ""}
          onChange={(event) =>
            setFields({ ...fields, categoryId: event.target.value ? Number(event.target.value) : null })
          }
          className="h-28 rounded-lg border border-input bg-transparent px-2 text-sm"
          size={6}
        >
          {filtered.map((category) => (
            <option key={category.id} value={category.id}>
              {formatCategory(category.code, category.name)}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void verify()}>
            Verify
          </Button>
          <Button type="button" variant="outline" onClick={() => setSplitOpen((open) => !open)}>
            Split
          </Button>
          <Button type="button" variant="outline" onClick={() => go(queue[index - 1])}>
            Previous
          </Button>
          <Button type="button" variant="outline" onClick={() => go(queue[index + 1])}>
            Next
          </Button>
        </div>
        {splitOpen ? (
          <div className="grid gap-2 rounded-xl border border-border p-3">
            <p className="text-sm">
              Split total must equal {formatMoney(fields.amount || "0")}. Current{" "}
              {formatMoney(
                centsToMoney(
                  sumCents(
                    splits
                      .map((line) => parseMoneyInput(line.amount))
                      .filter((cents): cents is number => cents != null)
                      .map((cents) => centsToMoney(cents)),
                  ),
                ),
              )}
            </p>
            {splits.map((line, lineIndex) => (
              <div key={lineIndex} className="grid gap-2">
                <Input
                  value={line.description}
                  onChange={(event) => {
                    const next = [...splits]
                    next[lineIndex] = { ...line, description: event.target.value }
                    setSplits(next)
                  }}
                  placeholder="Description"
                />
                <Input
                  value={line.amount}
                  onChange={(event) => {
                    const next = [...splits]
                    next[lineIndex] = { ...line, amount: event.target.value }
                    setSplits(next)
                  }}
                  placeholder="Amount"
                />
                <select
                  value={line.categoryId ?? ""}
                  onChange={(event) => {
                    const next = [...splits]
                    next[lineIndex] = {
                      ...line,
                      categoryId: event.target.value ? Number(event.target.value) : null,
                    }
                    setSplits(next)
                  }}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">Category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {formatCategory(category.code, category.name)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              onClick={() => setSplits([...splits, { description: "", amount: "", categoryId: null }])}
            >
              Add line
            </Button>
            <Button type="button" onClick={() => void saveLines()}>
              Save split
            </Button>
          </div>
        ) : null}
        {audit.length > 0 ? (
          <div>
            <p className="text-sm font-medium">Edit history</p>
            <ul className="mt-1 text-xs text-muted-foreground">
              {audit.map((entry, entryIndex) => (
                <li key={entryIndex}>
                  {entry.at.slice(0, 16)} {entry.field}: {entry.oldValue ?? "empty"} → {entry.newValue ?? "empty"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {returnDialog && needsReturn && returnAmount ? (
        <ReturnConfirmDialog
          amount={returnAmount}
          onConfirm={() => void acceptReturn()}
          onCorrect={() => void rejectReturn()}
          onDismiss={() => setReturnDialog(false)}
        />
      ) : null}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  low,
  type = "text",
  maxLength,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  low?: boolean
  type?: string
  maxLength?: number
  placeholder?: string
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={low ? "bg-amber-50" : undefined}
      />
    </div>
  )
}
