import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"

const KEY_LEN = 32

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex")
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex")
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split("$")
  if (scheme !== "scrypt" || !salt || !hash) return false
  const actual = scryptSync(password, salt, KEY_LEN)
  const expected = Buffer.from(hash, "hex")
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function boxKey() {
  const raw = process.env.PASSWORD_BOX_KEY ?? ""
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error("PASSWORD_BOX_KEY is missing. Add it to the server environment.")
  }
  return Buffer.from(raw, "hex")
}

/** Reversible copy so an existing login can be emailed again without changing it. */
export function sealPassword(password: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", boxKey(), iv)
  const encrypted = Buffer.concat([cipher.update(password, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`
}

export function openPassword(sealed: string) {
  const [ivHex, tagHex, dataHex] = sealed.split(".")
  if (!ivHex || !tagHex || !dataHex) throw new Error("The saved password cannot be read.")
  const decipher = createDecipheriv("aes-256-gcm", boxKey(), Buffer.from(ivHex, "hex"))
  decipher.setAuthTag(Buffer.from(tagHex, "hex"))
  const plain = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()])
  return plain.toString("utf8")
}

export function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  const bytes = randomBytes(10)
  let password = ""
  for (const byte of bytes) password += alphabet[byte % alphabet.length]
  return password
}
