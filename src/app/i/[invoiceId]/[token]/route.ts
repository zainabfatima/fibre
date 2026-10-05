import { openInvoice } from "@/lib/file-redirect"

export async function GET(
  request: Request,
  context: { params: Promise<{ invoiceId: string; token: string }> },
) {
  const { invoiceId, token } = await context.params
  return openInvoice(request, invoiceId, token)
}
