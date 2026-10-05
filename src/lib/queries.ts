import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"
import { requireAdmin } from "@/lib/db"
import type { Database } from "@/types/database"

export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"]
export type CategoryRow = Database["public"]["Tables"]["categories"]["Row"]
export type SummaryRow = Database["public"]["Views"]["v_project_summary"]["Row"]
export type CategoryTotalRow =
  Database["public"]["Views"]["v_project_category_totals"]["Row"]
export type ExpenseRow = Database["public"]["Views"]["v_expense_rows"]["Row"]
export type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"]

export async function listSummaries() {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("v_project_summary")
    .select("*")
    .order("name")
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function listCategoryTotals(projectId?: string) {
  const supabase = await requireAdmin()
  let query = supabase
    .from("v_project_category_totals")
    .select("*")
    .order("code")
  if (projectId) query = query.eq("project_id", projectId)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function listCategories(activeOnly = false) {
  const supabase = await requireAdmin()
  let query = supabase.from("categories").select("*").order("sort_order")
  if (activeOnly) query = query.eq("is_active", true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getProject(id: string) {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function getSummary(projectId: string) {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("v_project_summary")
    .select("*")
    .eq("project_id", projectId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function listExpenseRows(projectId: string) {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("v_expense_rows")
    .select("*")
    .eq("project_id", projectId)
    .order("expense_date", { ascending: false, nullsFirst: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function listInvoices(projectId: string) {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("project_id", projectId)
    .order("invoice_date", { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function getInvoice(id: string) {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export async function listClientPaymentAmounts() {
  const supabase = await requireAdmin()
  const { data, error } = await supabase.from("client_payments").select("project_id, amount")
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function listClientPayments(projectId: string) {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("client_payments")
    .select("*")
    .eq("project_id", projectId)
    .order("received_date", { ascending: false })
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function listBudgets(projectId: string) {
  const supabase = await requireAdmin()
  const { data, error } = await supabase
    .from("project_budgets")
    .select("*")
    .eq("project_id", projectId)
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function signStoragePath(
  bucket: "receipts" | "invoices",
  path: string | null,
  expiresIn = 60 * 30,
) {
  if (!path) return null
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn)
  if (error || !data) return null
  return data.signedUrl
}

export function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/$/,
    "",
  )
}
