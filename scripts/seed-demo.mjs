/**
 * Idempotent demo data: one project and about 20 receipt expenses.
 * Safe to run again — it exits if "3185 N Hembree Rd" already exists.
 */
import { createHash, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { createClient } from "@supabase/supabase-js"
import { PDFDocument, StandardFonts } from "pdf-lib"

function loadEnv(file) {
  const text = readFileSync(file, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match || process.env[match[1]]) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

loadEnv(resolve(process.cwd(), ".env.local"))

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const PROJECT_NAME = "3185 N Hembree Rd"

const samples = [
  { code: 1, vendor: "Northside Architects", date: "2026-01-08", amount: "4200.00", description: "Schematic design", method: "Check", invoice: "1001" },
  { code: 4, vendor: "City of Phoenix", date: "2026-01-15", amount: "1850.00", description: "Building permit", method: "Check", invoice: "1001" },
  { code: 12, vendor: "Desert Dumpsters", date: "2026-02-02", amount: "640.00", description: "30-yard dumpster", method: "Card", invoice: "1001" },
  { code: 13, vendor: "Valley Grading", date: "2026-02-10", amount: "8750.00", description: "Excavation and pad", method: "Check", invoice: "1001" },
  { code: 23, vendor: "Sonoran Concrete", date: "2026-02-20", amount: "21400.00", description: "Footings and slab", method: "Check", invoice: "1001" },
  { code: 25, vendor: "Apache Lumber", date: "2026-03-04", amount: "18620.50", description: "Framing package", method: "Account", invoice: "1001" },
  { code: 26, vendor: "Peak Roofing", date: "2026-03-18", amount: "9800.00", description: "Tile roof", method: "Check", invoice: "1002" },
  { code: 32, vendor: "Cool Air HVAC", date: "2026-03-22", amount: "11250.00", description: "Rough HVAC", method: "Check", invoice: "1002" },
  { code: 33, vendor: "Rio Plumbing", date: "2026-03-28", amount: "7640.00", description: "Rough plumbing", method: "Check", invoice: "1002" },
  { code: 34, vendor: "Bright Circuit", date: "2026-04-02", amount: "8930.00", description: "Rough electrical", method: "Check", invoice: "1002" },
  { code: 36, vendor: "Desert Insulation", date: "2026-04-12", amount: "3100.00", description: "Blown insulation", method: "Card", invoice: "1002" },
  { code: 37, vendor: "Smooth Wall Drywall", date: "2026-04-20", amount: "6400.00", description: "Hang and finish", method: "Check", invoice: null },
  { code: 40, vendor: "Floor Source", date: "2026-05-01", amount: "5280.75", description: "Engineered hardwood", method: "Card", invoice: null },
  { code: 41, vendor: "Casa Paint Co", date: "2026-05-08", amount: "4150.00", description: "Interior paint", method: "Check", invoice: null },
  { code: 47, vendor: "Cabinet Works", date: "2026-05-14", amount: "12980.00", description: "Kitchen cabinets", method: "Check", invoice: null },
  { code: 49, vendor: "Stone & Co", date: "2026-05-20", amount: "7425.00", description: "Quartz kitchen tops", method: "Check", invoice: null },
  { code: 52, vendor: "Appliance Gallery", date: "2026-05-28", amount: "6890.00", description: "Kitchen package", method: "Card", invoice: null },
  { code: 55, vendor: "Day Labor Crew", date: "2026-06-03", amount: "960.00", description: "Cleanup labor", method: "Cash", invoice: null },
  { code: 56, vendor: "Final Shine", date: "2026-06-10", amount: "450.00", description: "Final clean", method: "Card", invoice: null, review: true },
  { code: 58, vendor: "Home Depot", date: "2026-06-12", amount: "187.42", description: "Mixed supplies", method: "Card", invoice: null, review: true },
]

async function receiptPdf(sample) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([420, 560])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText("Receipt", { x: 36, y: 510, size: 18, font })
  page.drawText(sample.vendor, { x: 36, y: 470, size: 14, font })
  page.drawText(sample.date, { x: 36, y: 440, size: 12, font })
  page.drawText(`$${sample.amount}`, { x: 36, y: 410, size: 14, font })
  page.drawText(sample.description, { x: 36, y: 380, size: 12, font })
  page.drawText(randomUUID(), { x: 36, y: 40, size: 8, font })
  return Buffer.from(await doc.save())
}

function moneyToCents(value) {
  const [whole, fraction = ""] = String(value).split(".")
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2))
}

function centsToMoney(cents) {
  const whole = Math.floor(cents / 100)
  const fraction = String(cents % 100).padStart(2, "0")
  return `${whole}.${fraction}`
}

const { data: existing, error: existingError } = await supabase
  .from("projects")
  .select("id")
  .eq("name", PROJECT_NAME)
  .maybeSingle()
if (existingError) {
  console.error(existingError.message)
  process.exit(1)
}
if (existing) {
  console.log(`Demo project already exists (${existing.id}). Nothing inserted.`)
  process.exit(0)
}

const { data: project, error: projectError } = await supabase
  .from("projects")
  .insert({
    name: PROJECT_NAME,
    address: "3185 N Hembree Rd, Phoenix, AZ",
    client_name: "Alex Rivera",
    client_email: "alex@example.com",
    builder_fee_percent: 15,
    retainage_percent: 0,
    status: "active",
    contract_amount: "485000.00",
  })
  .select("id")
  .single()
if (projectError || !project) {
  console.error(projectError?.message ?? "Could not create the project")
  process.exit(1)
}

const { data: categories, error: categoryError } = await supabase
  .from("categories")
  .select("id, code")
if (categoryError || !categories) {
  console.error(categoryError?.message ?? "Could not load categories")
  process.exit(1)
}
const categoryByCode = new Map(categories.map((row) => [row.code, row.id]))

const invoiceIds = {}
for (const number of ["1001", "1002"]) {
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      project_id: project.id,
      invoice_number: number,
      invoice_date: number === "1001" ? "2026-03-31" : "2026-04-30",
      status: number === "1001" ? "paid" : "pending",
      paid_date: number === "1001" ? "2026-04-15" : null,
      notes: "Demo invoice",
    })
    .select("id")
    .single()
  if (error || !data) {
    console.error(error?.message ?? "Could not create an invoice")
    process.exit(1)
  }
  invoiceIds[number] = data.id
}

const uploaded = []
for (const sample of samples) {
  const bytes = await receiptPdf(sample)
  const hash = createHash("sha256").update(bytes).digest("hex")
  const id = randomUUID()
  const path = `${project.id}/${id}.pdf`
  const stored = await supabase.storage.from("receipts").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
  })
  if (stored.error) {
    console.error(stored.error.message)
    process.exit(1)
  }
  uploaded.push(path)
  const categoryId = categoryByCode.get(sample.code)
  if (!categoryId) {
    console.error(`Missing category code ${sample.code}`)
    process.exit(1)
  }
  const needsReview = Boolean(sample.review)
  const { error } = await supabase.from("expenses").insert({
    id,
    project_id: project.id,
    category_id: needsReview ? null : categoryId,
    vendor: sample.vendor,
    expense_date: sample.date,
    amount: sample.amount,
    description: sample.description,
    payment_method: sample.method,
    receipt_file_path: path,
    receipt_file_hash: hash,
    invoice_id: sample.invoice ? invoiceIds[sample.invoice] : null,
    verification_status: needsReview ? "needs_review" : "verified",
    ai_confidence: needsReview ? 0.42 : 0.91,
    ai_suggested_category_ids: [sample.code],
  })
  if (error) {
    console.error(error.message)
    process.exit(1)
  }
}

for (const number of ["1001", "1002"]) {
  const { data, error } = await supabase
    .from("invoices")
    .select("subtotal, builder_fee, retainage")
    .eq("id", invoiceIds[number])
    .single()
  if (error || !data) {
    console.error(error?.message ?? "Could not read invoice totals")
    process.exit(1)
  }
  const expected =
    moneyToCents(data.subtotal) +
    moneyToCents(data.builder_fee) -
    moneyToCents(data.retainage)
  const total = centsToMoney(expected)
  const { error: updateError } = await supabase
    .from("invoices")
    .update({
      total_amount: total,
      amount_paid: number === "1001" ? total : "0.00",
    })
    .eq("id", invoiceIds[number])
  if (updateError) {
    console.error(updateError.message)
    process.exit(1)
  }
}

const budgets = [
  [23, "25000.00"],
  [25, "20000.00"],
  [47, "14000.00"],
]
for (const [code, amount] of budgets) {
  const categoryId = categoryByCode.get(code)
  const { error } = await supabase.from("project_budgets").insert({
    project_id: project.id,
    category_id: categoryId,
    budget_amount: amount,
  })
  if (error) {
    console.error(error.message)
    process.exit(1)
  }
}

console.log(`Seeded ${PROJECT_NAME} (${project.id}) with ${samples.length} expenses and ${uploaded.length} receipt files.`)
