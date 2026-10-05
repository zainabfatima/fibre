"use server"

import { revalidatePath } from "next/cache"

import { requireAdmin } from "@/lib/db"
import { centsToMoney, parseMoneyInput } from "@/lib/money"

function refresh(projectId: string) {
  revalidatePath("/")
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/payments`)
}

export async function addClientPayment(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const receivedDate = String(formData.get("receivedDate") ?? "")
  const amountText = String(formData.get("amount") ?? "")
  const note = String(formData.get("note") ?? "").trim()
  const cents = parseMoneyInput(amountText)
  if (!receivedDate) return { error: "Enter the date the money was received" }
  if (cents == null || cents <= 0) return { error: "Enter an amount greater than zero" }

  const supabase = await requireAdmin()
  const { error } = await supabase.from("client_payments").insert({
    project_id: projectId,
    received_date: receivedDate,
    amount: centsToMoney(cents),
    note: note || null,
  })
  if (error) return { error: error.message }
  refresh(projectId)
  return { error: null }
}

export async function deleteClientPayment(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "")
  const paymentId = String(formData.get("paymentId") ?? "")
  const supabase = await requireAdmin()
  const { error } = await supabase
    .from("client_payments")
    .delete()
    .eq("id", paymentId)
    .eq("project_id", projectId)
  if (error) return { error: error.message }
  refresh(projectId)
  return { error: null }
}
