/** Where a staff session should land when it opens an office URL. */
export function staffOfficeDestination(pathname: string, projectIds: string[]) {
  const path = pathname.split("?")[0] ?? ""
  const match = path.match(/^\/projects\/([^/]+)(?:\/|$)/)
  if (match && projectIds.includes(match[1])) return `/staff/${match[1]}`
  return "/staff"
}
