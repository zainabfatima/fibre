import { AppHeader } from "@/components/app-header"
import { ProjectForm } from "@/components/project-form"

export default function NewProjectPage() {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <h1 className="mb-4 text-2xl font-semibold">New project</h1>
        <ProjectForm />
      </main>
    </>
  )
}
