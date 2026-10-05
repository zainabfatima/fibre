import { notFound } from "next/navigation"

import { updateInvoice, uploadInvoiceFile } from "@/app/actions/invoices"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createAdminClient } from "@/lib/supabase/admin"
import { formatMoney } from "@/lib/money"
import { formatCategory } from "@/lib/format"
import { getInvoice, listExpenseRows } from "@/lib/queries"

export const dynamic = "force-dynamic"

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>
}) {
  const { id, invoiceId } = await params
  const invoice = await getInvoice(invoiceId)
  if (!invoice || invoice.project_id !== id) notFound()
  const expenses = (await listExpenseRows(id)).filter((row) => row.invoice_id === invoiceId)
  const admin = createAdminClient()
  const thumbs = expenses
    .map((row) => row.receipt_thumbnail_path)
    .filter((path): path is string => Boolean(path))
  const signed = thumbs.length
    ? await admin.storage.from("receipts").createSignedUrls(thumbs, 1800)
    : { data: [] }
  const thumbByPath = new Map((signed.data ?? []).map((item) => [item.path, item.signedUrl]))
  let fileUrl: string | null = null
  if (invoice.file_path) {
    const file = await admin.storage.from("invoices").createSignedUrl(invoice.file_path, 1800)
    fileUrl = file.data?.signedUrl ?? null
  }

  return (
    <div className="grid gap-6 px-4 py-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="grid content-start gap-4">
        <div>
          <h2 className="text-xl font-semibold">{invoice.invoice_number}</h2>
          <p className="text-sm text-muted-foreground">{expenses.length} expenses</p>
          <p className="text-lg font-semibold tabular-nums">{formatMoney(invoice.subtotal)}</p>
        </div>
        <form action={updateInvoice} className="grid gap-3">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <input type="hidden" name="projectId" value={id} />
          <label className="grid gap-1 text-sm">
            Date
            <Input type="date" name="invoiceDate" defaultValue={invoice.invoice_date} />
          </label>
          <label className="grid gap-1 text-sm">
            Status
            <select name="status" defaultValue={invoice.status} className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm">
              <option value="pending">Pending</option>
              <option value="partially_paid">Partially paid</option>
              <option value="paid">Paid</option>
              <option value="void">Void</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Amount paid
            <Input name="amountPaid" defaultValue={String(invoice.amount_paid)} />
          </label>
          <label className="grid gap-1 text-sm">
            Paid date
            <Input type="date" name="paidDate" defaultValue={invoice.paid_date ?? ""} />
          </label>
          <label className="grid gap-1 text-sm">
            Notes
            <Input name="notes" defaultValue={invoice.notes ?? ""} />
          </label>
          <Button type="submit">Save invoice</Button>
        </form>
        <form action={uploadInvoiceFile} className="grid gap-2">
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <input type="hidden" name="projectId" value={id} />
          <Label htmlFor="invoice-file">Invoice image or PDF</Label>
          <input id="invoice-file" name="file" type="file" accept="image/*,application/pdf" />
          <Button type="submit" variant="outline">
            Upload file
          </Button>
        </form>
        {fileUrl ? (
          invoice.file_path?.endsWith(".pdf") ? (
            <a href={fileUrl} target="_blank" rel="noreferrer" className="text-sm underline">
              Open invoice PDF
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl} alt="Invoice" className="max-h-80 w-full rounded-lg object-contain" />
          )
        ) : null}
      </div>
      <ul className="grid gap-2">
        {expenses.map((expense) => (
          <li key={expense.id} className="flex items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
            {expense.receipt_thumbnail_path && thumbByPath.get(expense.receipt_thumbnail_path) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbByPath.get(expense.receipt_thumbnail_path) ?? ""}
                alt=""
                className="h-14 w-14 rounded object-cover"
              />
            ) : (
              <a href={`/r/${expense.id}`} className="text-xs underline">
                File
              </a>
            )}
            <div className="min-w-0">
              <p className="truncate font-medium">{expense.vendor || "Unknown vendor"}</p>
              <p className="truncate text-sm text-muted-foreground">
                {expense.expense_date} ·{" "}
                {expense.category_code && expense.category_name
                  ? formatCategory(expense.category_code, expense.category_name)
                  : "No category"}
              </p>
            </div>
            <p className="ml-auto tabular-nums">{formatMoney(expense.amount)}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
