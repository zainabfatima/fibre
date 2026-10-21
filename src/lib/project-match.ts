export type MatchProject = {
  id: string
  name: string
  address: string | null
}

export const MATCH_PRESELECT = 0.34

function tokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1)
}

function coverage(needles: string[], haystack: string[]) {
  if (needles.length === 0) return 0
  const hay = new Set(haystack)
  return needles.filter((token) => hay.has(token)).length / needles.length
}

export function scoreProject(project: MatchProject, requestedName: string, requestedAddress: string) {
  const nameTokens = tokens(requestedName)
  const addressTokens = tokens(requestedAddress)
  const projectName = tokens(project.name)
  const projectAddress = tokens(project.address ?? "")
  const nameScore = coverage(nameTokens, projectName)
  const addressScore = coverage(addressTokens, [...projectAddress, ...projectName])
  let score = nameScore * 0.65 + addressScore * 0.35
  const requested = requestedName.trim().toLowerCase()
  const current = project.name.trim().toLowerCase()
  if (requested && current && (current.includes(requested) || requested.includes(current))) score += 0.25
  const requestedAddressNorm = requestedAddress.trim().toLowerCase()
  const currentAddress = (project.address ?? "").trim().toLowerCase()
  if (
    requestedAddressNorm &&
    currentAddress &&
    (currentAddress.includes(requestedAddressNorm) || requestedAddressNorm.includes(currentAddress))
  ) {
    score += 0.2
  }
  return Math.min(score, 1)
}

export function bestProjectMatch(projects: MatchProject[], requestedName: string, requestedAddress: string) {
  let best: { project: MatchProject; score: number } | null = null
  for (const project of projects) {
    const score = scoreProject(project, requestedName, requestedAddress)
    if (!best || score > best.score) best = { project, score }
  }
  if (!best || best.score <= 0) return null
  return best
}

export function matchLabel(match: { project: MatchProject; score: number } | null) {
  if (!match) return "No project matched this name and address. Pick the project yourself."
  const place = match.project.address ? ` — ${match.project.address}` : ""
  return `Closest project (${Math.round(match.score * 100)}%): ${match.project.name}${place}`
}
