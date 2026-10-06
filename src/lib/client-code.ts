const CLIENT_CODE = /^\d{1,32}$/

/** Leading digits of a project name, such as "5059 Hidden Branch" → "5059". */
export function clientCodeFromName(name: string): string | null {
  const match = name.trim().match(/^(\d+)/)
  const code = match?.[1]
  if (!code || !CLIENT_CODE.test(code)) return null
  return code
}

export function isClientCode(value: string) {
  return CLIENT_CODE.test(value)
}
