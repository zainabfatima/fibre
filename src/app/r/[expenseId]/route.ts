import { openReceipt } from "@/lib/file-redirect"

export async function GET(
  request: Request,
  context: { params: Promise<{ expenseId: string }> },
) {
  const { expenseId } = await context.params
  return openReceipt(request, expenseId)
}
