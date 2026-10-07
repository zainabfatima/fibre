import { createRequire, Module } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync } from "node:fs"

const require = createRequire(import.meta.url)
const stub = resolve(dirname(fileURLToPath(import.meta.url)), "server-only-stub.cjs")
const original = Module._resolveFilename
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "server-only") return stub
  return original.call(this, request, parent, isMain, options)
}

const envFile = readFileSync(resolve(process.cwd(), ".env.local"), "utf8")
for (const line of envFile.split(/\r?\n/)) {
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

const { scanAllReceiptIdentities } = await import("../src/lib/extract-receipt.ts")
const result = await scanAllReceiptIdentities((done, total, detail) => {
  console.log(`${done}/${total} ${detail}`)
})
console.log(
  `Finished. Read ${result.scanned} receipts, ${result.failed} failed, ${result.flagged} marked as duplicates.`,
)
