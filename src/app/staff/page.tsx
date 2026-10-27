import Link from "next/link"

import { StaffHeader } from "@/components/staff-header"
import { listStaffProjects, requireStaff } from "@/lib/staff"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Progress pictures",
}

export default async function StaffHomePage() {
  const user = await requireStaff()
  const projects = await listStaffProjects(user.project_ids)

  return (
    <>
      <StaffHeader projectsHref={false} />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Your projects</h1>
          <p className="text-sm text-muted-foreground">
            Upload progress pictures for the projects assigned to you.
          </p>
        </div>
        {projects.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No projects are assigned to this login yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/staff/${project.id}`}
                  className="block rounded-xl bg-card p-4 ring-1 ring-foreground/10 hover:bg-accent"
                >
                  <span className="font-medium">{project.name}</span>
                  {project.address ? (
                    <span className="mt-1 block text-sm text-muted-foreground">{project.address}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
