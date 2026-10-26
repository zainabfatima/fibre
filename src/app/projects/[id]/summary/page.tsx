import { ExpenseDetailSummary, type DetailAmount, type DetailExpense } from "@/components/expense-detail-summary"
import { formatCategory } from "@/lib/format"
import { moneyToCents, sumCents } from "@/lib/money"
import { getProject, getSummary, listClientPaidExpenses, listClientPayments, listExpenseRows } from "@/lib/queries"

export const dynamic = "force-dynamic"

export default async function ProjectSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProject(id)
  if (!project) return null

  const [expenses, clientPaid, payments, summary] = await Promise.all([
    listExpenseRows(id),
    listClientPaidExpenses(id),
    listClientPayments(id),
    getSummary(id),
  ])
  const expenseLines = dated<DetailExpense>(
    expenses.map((row) => ({
      id: row.id,
      date: row.expense_date,
      label: row.vendor?.trim() || "Receipt",
      category: row.category_code != null && row.category_name ? formatCategory(row.category_code, row.category_name) : "Uncategorized",
      categorySort: row.category_code ?? 9999,
      amountCents: moneyToCents(row.amount),
    })),
  )
  const clientLines = dated(
    clientPaid.map((row) => ({
      id: row.id,
      date: row.paid_date,
      label: row.note?.trim() || "Paid by client",
      amountCents: moneyToCents(row.amount),
    })),
  )
  const paymentLines = dated(
    payments.map((row) => ({
      id: row.id,
      date: row.received_date,
      label: row.note?.trim() || "Funds Received",
      amountCents: moneyToCents(row.amount),
    })),
  )

  return (
    <div className="px-4 py-4">
      <ExpenseDetailSummary
        percent={project.builder_fee_percent}
        expenses={expenseLines}
        clientPaid={clientLines}
        payments={paymentLines}
        billableCents={moneyToCents(summary?.total_spent ?? 0)}
        builderFeeCents={moneyToCents(summary?.builder_fee_amount ?? 0)}
        clientPaidCents={moneyToCents(summary?.client_paid_total ?? 0)}
        receivedCents={sumCents(payments.map((payment) => payment.amount))}
        excelHref={`/api/export/${id}?kind=summary`}
      />
    </div>
  )
}

function dated<T extends DetailAmount>(rows: T[]) {
  return [...rows].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"))
}
