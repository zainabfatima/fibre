import Link from "next/link"

type PortalProject = {
  id: string
  name: string
  address: string | null
  code: string | null
}

export function ClientProjectList({ projects }: { projects: PortalProject[] }) {
  return (
    <div className="grid gap-3 px-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Your projects</h1>
        <p className="text-sm text-muted-foreground">Open a project to see its expenses.</p>
      </div>
      <div className="grid gap-3">
        {projects.map((project) =>
          project.code ? (
            <Link
              key={project.id}
              href={`/client/${project.code}`}
              className="rounded-xl border-l-4 border-l-primary bg-card p-4 ring-1 ring-foreground/15 hover:ring-primary/40"
            >
              <h2 className="text-lg font-bold break-words text-primary">{project.name}</h2>
              <p className="text-sm break-words text-muted-foreground">{project.address || "No address"}</p>
            </Link>
          ) : (
            <div key={project.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <h2 className="text-lg font-bold break-words">{project.name}</h2>
              <p className="text-sm text-muted-foreground">
                This project name needs a number at the start before its expenses can open.
              </p>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

export function ClientProjectSwitcher({
  projects,
  currentCode,
}: {
  projects: { code: string; name: string }[]
  currentCode: string
}) {
  return (
    <nav aria-label="Your projects" className="mb-3 flex touch-pan-x gap-1 overflow-x-auto">
      <Link
        href="/client"
        className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground ring-1 ring-foreground/10 hover:text-foreground"
      >
        All projects
      </Link>
      {projects.map((project) => {
        const current = project.code === currentCode
        return (
          <Link
            key={project.code}
            href={`/client/${project.code}`}
            aria-current={current ? "page" : undefined}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${
              current ? "bg-primary text-primary-foreground" : "text-foreground ring-1 ring-foreground/10 hover:bg-accent"
            }`}
          >
            {project.name}
          </Link>
        )
      })}
    </nav>
  )
}
