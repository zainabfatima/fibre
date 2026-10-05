import { openReceipt } from "@/lib/file-redirect"

export async function GET(
  request: Request,
  context: { params: Promise<{ expenseId: string; token: string }> },
) {
  const { expenseId, token } = await context.params
  return openReceipt(request, expenseId, token)
}
