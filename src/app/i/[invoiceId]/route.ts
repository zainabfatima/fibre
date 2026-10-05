import { openInvoice } from "@/lib/file-redirect"

export async function GET(
  request: Request,
  context: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await context.params
  return openInvoice(request, invoiceId)
}
