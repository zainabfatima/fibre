import Link from "next/link"

import { formatMoney } from "@/lib/money"
import { getProject, listExpenseRows, listInvoices } from "@/lib/queries"
import { StatusBadge } from "@/components/status-badge"

export const dynamic = "force-dynamic"

export default async function InvoicesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProject(id)
  if (project && !project.invoice_tracking) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        This project records money received from the client.{" "}
        <Link href={`/projects/${id}/payments`} className="underline">
          Open money received
        </Link>
      </p>
    )
  }
  const [invoices, expenses] = await Promise.all([listInvoices(id), listExpenseRows(id)])
  const counts = new Map<string, number>()
  for (const expense of expenses) {
    if (!expense.invoice_id) continue
    counts.set(expense.invoice_id, (counts.get(expense.invoice_id) ?? 0) + 1)
  }

  return (
    <div className="px-4 py-4">
      {invoices.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          No invoices yet. Add an invoice number on the expense sheet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {["Number", "Date", "Expenses", "Amount", "Status", "Paid", "File"].map((heading) => (
                  <th key={heading} className="px-3 py-2 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                return (
                  <tr key={invoice.id} className="border-b border-border/70">
                    <td className="px-3 py-2">
                      <Link href={`/projects/${id}/invoices/${invoice.id}`} className="underline">
                        {invoice.invoice_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{invoice.invoice_date}</td>
                    <td className="px-3 py-2">{counts.get(invoice.id) ?? 0}</td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(invoice.subtotal)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge kind="invoice" status={invoice.status} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">{formatMoney(invoice.amount_paid)}</td>
                    <td className="px-3 py-2">
                      {invoice.file_path ? (
                        <a href={`/i/${invoice.id}`} target="_blank" rel="noreferrer" className="underline">
                          View
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
