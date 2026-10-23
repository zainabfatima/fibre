const src = new URL("../src/", import.meta.url)

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return nextResolve(new URL(`${specifier.slice(2)}.ts`, src).href, context)
  }
  return nextResolve(specifier, context)
}
