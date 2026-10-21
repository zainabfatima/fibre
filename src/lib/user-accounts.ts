import "server-only"

import { revalidatePath } from "next/cache"

import { getAdminUser } from "@/lib/app-session"
import { clientCodeFromName } from "@/lib/client-code"
import { requireAdmin } from "@/lib/db"
import { ADMIN_INBOX, OFFICE_CC, appOrigin, sendAppMail, sendOfficeCopy } from "@/lib/mail"
import { generatePassword, hashPassword, openPassword, sealPassword } from "@/lib/passwords"
import { MATCH_PRESELECT, bestProjectMatch, matchLabel, type MatchProject } from "@/lib/project-match"
import { createAdminClient } from "@/lib/supabase/admin"

export type UserFormState = {
  error: string | null
  message: string | null
}

type ProjectChoice = MatchProject

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function text(formData: FormData, name: string) {
  const value = formData.get(name)
  return (typeof value === "string" ? value : "").trim()
}

function normalizeLogin(value: string) {
  return value.trim().toLowerCase()
}

function passwordError(password: string) {
  if (password.length < 4) return "Use at least 4 characters for the password."
  if (password.length > 72) return "Use a password of 72 characters or fewer."
  return null
}

function projectProblem(project: ProjectChoice | undefined) {
  if (!project) return "Choose a project."
  if (!clientCodeFromName(project.name)) {
    return "That project name has to start with its project number, such as 5059 Hidden Branch, before a client can open it."
  }
  return null
}

async function loadProjects() {
  const admin = createAdminClient()
  const { data, error } = await admin.from("projects").select("id, name, address").order("name")
  if (error) throw new Error(error.message)
  return data ?? []
}

async function findAccount(identifier: string) {
  const key = normalizeLogin(identifier)
  if (!key) return null
  const admin = createAdminClient()
  const byLogin = await admin.from("app_users").select("*").eq("login_id", key).maybeSingle()
  if (byLogin.error) throw new Error(byLogin.error.message)
  if (byLogin.data) return byLogin.data
  const byEmail = await admin.from("app_users").select("*").eq("email", key).maybeSingle()
  if (byEmail.error) throw new Error(byEmail.error.message)
  return byEmail.data
}

function loginLetter(input: {
  loginId: string
  password: string
  projectName: string
  projectAddress: string | null
}) {
  return [
    "Your Fibre Construction login is ready.",
    "",
    `User ID: ${input.loginId}`,
    `Password: ${input.password}`,
    "",
    `Sign in: ${appOrigin()}/login`,
    "",
    "This login can view only this project:",
    input.projectName,
    input.projectAddress ?? "",
  ].join("\n")
}

async function emailCredentials(input: {
  to: string | null
  loginId: string
  password: string
  projectName: string
  projectAddress: string | null
  subject: string
}) {
  const loginId = input.loginId.replace(/[\r\n]+/g, "")
  const letter = loginLetter({ ...input, loginId })
  const office = await sendOfficeCopy({
    to: ADMIN_INBOX,
    cc: OFFICE_CC,
    subject: `${input.subject.replace(/[\r\n]+/g, " ")} — ${loginId}`,
    text: `${letter}\n\nSent to: ${input.to || "office inbox only"}`,
  })
  const recipient = input.to?.trim().toLowerCase() ?? ""
  if (!recipient || recipient === ADMIN_INBOX) return office
  await sendAppMail({ to: recipient, subject: input.subject.replace(/[\r\n]+/g, " "), text: letter })
  return office
}

function savedPassword(account: { password_encrypted: string | null }) {
  if (!account.password_encrypted) throw new Error("This account has no saved password yet.")
  return openPassword(account.password_encrypted)
}

export async function loadUsersPage() {
  await requireAdmin()
  const admin = createAdminClient()
  const [usersResult, projects] = await Promise.all([
    admin
      .from("app_users")
      .select("id, login_id, email, role, status, project_id, requested_project_name, requested_address, created_at")
      .order("created_at", { ascending: false }),
    loadProjects(),
  ])
  if (usersResult.error) throw new Error(usersResult.error.message)
  const users = usersResult.data ?? []
  const requests = users
    .filter((user) => user.status !== "active")
    .map((user) => {
      const match = bestProjectMatch(projects, user.requested_project_name ?? "", user.requested_address ?? "")
      return {
        ...user,
        suggestedPassword: generatePassword(),
        matchText: matchLabel(match),
        suggestedProjectId: match && match.score >= MATCH_PRESELECT ? match.project.id : "",
      }
    })
  return {
    projects,
    requests,
    accounts: users.filter((user) => user.status === "active"),
  }
}

export async function requestSignup(formData: FormData): Promise<UserFormState> {
  const email = normalizeLogin(text(formData, "email"))
  const projectName = text(formData, "projectName")
  const address = text(formData, "address")
  if (!EMAIL.test(email)) return { error: "Enter a valid email.", message: null }
  if (!projectName || projectName.length > 200) return { error: "Enter the project name.", message: null }
  if (!address || address.length > 300) return { error: "Enter the project address.", message: null }

  const admin = createAdminClient()
  const existing = await findAccount(email)
  if (existing?.status === "active") {
    return { error: "An account already uses that email. Use Forgot password on the sign-in page.", message: null }
  }

  if (existing) {
    const { error } = await admin
      .from("app_users")
      .update({
        email,
        login_id: email,
        role: "client",
        status: "pending",
        requested_project_name: projectName,
        requested_address: address,
      })
      .eq("id", existing.id)
    if (error) return { error: error.message, message: null }
  } else {
    const { error } = await admin.from("app_users").insert({
      login_id: email,
      email,
      role: "client",
      status: "pending",
      requested_project_name: projectName,
      requested_address: address,
    })
    if (error) return { error: error.message, message: null }
  }

  const projects = await loadProjects()
  const match = bestProjectMatch(projects, projectName, address)
  try {
    await sendOfficeCopy({
      to: ADMIN_INBOX,
      cc: OFFICE_CC,
      subject: `Signup request — ${email}`,
      text: [
        "A client requested access.",
        "",
        `Email: ${email}`,
        `Project name: ${projectName}`,
        `Address: ${address}`,
        matchLabel(match),
        "",
        `Review and approve: ${appOrigin()}/users`,
      ].join("\n"),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Email failed."
    return {
      error: `The request was saved, but the office email did not send. ${reason}`,
      message: null,
    }
  }

  revalidatePath("/users")
  return {
    error: null,
    message: "Request sent. After the office matches your project, they email your user ID and password.",
  }
}

export async function reviewSignupRequest(formData: FormData): Promise<UserFormState> {
  await requireAdmin()
  const userId = text(formData, "userId")
  const intent = text(formData, "intent")
  const admin = createAdminClient()
  const { data: user, error } = await admin.from("app_users").select("*").eq("id", userId).maybeSingle()
  if (error) return { error: error.message, message: null }
  if (!user || user.status === "active") return { error: "That signup request was not found.", message: null }

  if (intent === "reject") {
    const { error: updateError } = await admin.from("app_users").update({ status: "rejected" }).eq("id", user.id)
    if (updateError) return { error: updateError.message, message: null }
    revalidatePath("/users")
    return { error: null, message: `Rejected ${user.email || user.login_id}.` }
  }

  const loginId = normalizeLogin(text(formData, "loginId"))
  const email = normalizeLogin(text(formData, "email"))
  const password = text(formData, "password")
  const projectId = text(formData, "projectId")
  if (!loginId) return { error: "Enter a user ID.", message: null }
  if (!EMAIL.test(email)) return { error: "Enter the email that should receive the login.", message: null }
  const weak = passwordError(password)
  if (weak) return { error: weak, message: null }

  const projects = await loadProjects()
  const project = projects.find((item) => item.id === projectId)
  const problem = projectProblem(project)
  if (problem || !project) return { error: problem ?? "Choose a project.", message: null }

  const { error: updateError } = await admin
    .from("app_users")
    .update({
      login_id: loginId,
      email,
      password_hash: hashPassword(password),
      password_encrypted: sealPassword(password),
      role: "client",
      status: "active",
      project_id: project.id,
    })
    .eq("id", user.id)
  if (updateError) return { error: duplicateMessage(updateError.message), message: null }

  return finishCredentials({
    userId: user.id,
    to: email,
    loginId,
    password,
    project,
    subject: "Your Fibre Construction login",
    success: `Approved ${loginId}. The login was emailed to ${email} and to ${ADMIN_INBOX}, with a copy to ${OFFICE_CC}.`,
  })
}

export async function createAccount(formData: FormData): Promise<UserFormState> {
  await requireAdmin()
  const loginId = normalizeLogin(text(formData, "loginId"))
  const emailRaw = normalizeLogin(text(formData, "email"))
  const email = emailRaw || (EMAIL.test(loginId) ? loginId : "")
  const password = text(formData, "password")
  const role = text(formData, "role") === "admin" ? "admin" : "client"
  const projectId = text(formData, "projectId")
  const sendEmail = formData.get("sendEmail") === "on"
  if (!loginId) return { error: "Enter a user ID.", message: null }
  if (email && !EMAIL.test(email)) return { error: "Enter a valid email.", message: null }
  const weak = passwordError(password)
  if (weak) return { error: weak, message: null }

  let project: ProjectChoice | undefined
  if (role === "client") {
    const projects = await loadProjects()
    project = projects.find((item) => item.id === projectId)
    const problem = projectProblem(project)
    if (problem || !project) return { error: problem ?? "Choose a project.", message: null }
  }
  if (sendEmail && !email) return { error: "Enter an email so the login can be sent.", message: null }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("app_users")
    .insert({
      login_id: loginId,
      email: email || null,
      password_hash: hashPassword(password),
      password_encrypted: sealPassword(password),
      role,
      status: "active",
      project_id: role === "client" ? project?.id ?? null : null,
    })
    .select("id")
    .single()
  if (error) return { error: duplicateMessage(error.message), message: null }

  if (!sendEmail) {
    revalidatePath("/users")
    return { error: null, message: `Added ${loginId}.` }
  }

  return finishCredentials({
    userId: data.id,
    to: email,
    loginId,
    password,
    project: project ?? null,
    subject: role === "admin" ? "Your Fibre Construction admin login" : "Your Fibre Construction login",
    success: `Added ${loginId}. The login was emailed to ${email} and to ${ADMIN_INBOX}, with a copy to ${OFFICE_CC}.`,
  })
}

export async function saveAccount(formData: FormData): Promise<UserFormState> {
  await requireAdmin()
  const userId = text(formData, "userId")
  const loginId = normalizeLogin(text(formData, "loginId"))
  const email = normalizeLogin(text(formData, "email"))
  const role = text(formData, "role") === "admin" ? "admin" : "client"
  const projectId = text(formData, "projectId")
  const password = text(formData, "password")
  const admin = createAdminClient()
  const { data: user, error } = await admin.from("app_users").select("*").eq("id", userId).maybeSingle()
  if (error) return { error: error.message, message: null }
  if (!user || user.status !== "active") return { error: "That account was not found.", message: null }
  if (!loginId) return { error: "Enter a user ID.", message: null }
  if (user.login_id === "fibre" && (loginId !== "fibre" || role !== "admin")) {
    return { error: "The fibre office login stays an admin.", message: null }
  }
  if (email && !EMAIL.test(email)) return { error: "Enter a valid email.", message: null }

  let project: ProjectChoice | null = null
  if (role === "client") {
    const projects = await loadProjects()
    project = projects.find((item) => item.id === projectId) ?? null
    const problem = projectProblem(project ?? undefined)
    if (problem || !project) return { error: problem ?? "Choose a project.", message: null }
  }

  const patch: {
    login_id: string
    email: string | null
    role: "admin" | "client"
    project_id: string | null
    password_hash?: string
    password_encrypted?: string
  } = {
    login_id: loginId,
    email: email || null,
    role,
    project_id: project?.id ?? null,
  }
  if (password) {
    const weak = passwordError(password)
    if (weak) return { error: weak, message: null }
    patch.password_hash = hashPassword(password)
    patch.password_encrypted = sealPassword(password)
  }

  const { error: updateError } = await admin.from("app_users").update(patch).eq("id", user.id)
  if (updateError) return { error: duplicateMessage(updateError.message), message: null }
  if (password) await dropOtherSessions(user.id)

  revalidatePath("/users")
  return { error: null, message: password ? `Saved ${loginId}, including the new password.` : `Saved ${loginId}.` }
}

export async function deleteAccount(formData: FormData): Promise<UserFormState> {
  await requireAdmin()
  const current = await getAdminUser()
  const userId = text(formData, "userId")
  const admin = createAdminClient()
  const { data: user, error } = await admin.from("app_users").select("id, login_id").eq("id", userId).maybeSingle()
  if (error) return { error: error.message, message: null }
  if (!user) return { error: "That account was not found.", message: null }
  if (user.login_id === "fibre") return { error: "The fibre office login cannot be deleted.", message: null }
  if (current?.id === user.id) return { error: "Sign in as another admin before deleting your own login.", message: null }

  const { error: deleteError } = await admin.from("app_users").delete().eq("id", user.id)
  if (deleteError) return { error: deleteError.message, message: null }
  revalidatePath("/users")
  return { error: null, message: `Deleted ${user.login_id}.` }
}

export async function emailSavedPassword(formData: FormData): Promise<UserFormState> {
  await requireAdmin()
  const userId = text(formData, "userId")
  const admin = createAdminClient()
  const { data: user, error } = await admin.from("app_users").select("*").eq("id", userId).maybeSingle()
  if (error) return { error: error.message, message: null }
  if (!user || user.status !== "active") return { error: "That account was not found.", message: null }
  if (!user.email) return { error: "Add an email on this account before sending the login.", message: null }

  let project: ProjectChoice | null = null
  if (user.role === "client") {
    if (!user.project_id) return { error: "Assign a project before emailing this login.", message: null }
    const projects = await loadProjects()
    project = projects.find((item) => item.id === user.project_id) ?? null
    const problem = projectProblem(project ?? undefined)
    if (problem || !project) return { error: problem ?? "Assign a project before emailing this login.", message: null }
  }

  let password = ""
  try {
    password = savedPassword(user)
  } catch (openError) {
    return { error: openError instanceof Error ? openError.message : "The saved password cannot be read.", message: null }
  }

  return finishCredentials({
    userId: user.id,
    to: user.email,
    loginId: user.login_id,
    password,
    project,
    subject: "Your Fibre Construction login",
    success: `Emailed the saved login for ${user.login_id}. The project view was left as it is.`,
  })
}

export async function forgotPassword(formData: FormData): Promise<UserFormState> {
  const identifier = text(formData, "email")
  if (!identifier) return { error: "Enter the email or user ID on the account.", message: null }
  const user = await findAccount(identifier)
  if (!user) return { error: "No account uses that email.", message: null }
  if (user.role === "admin") return { error: "Admin passwords are changed on the Users page after you sign in.", message: null }
  if (user.status === "pending") return { error: "This signup is still waiting for approval.", message: null }
  if (user.status !== "active" || !user.project_id) return { error: "This account is not active.", message: null }

  const projects = await loadProjects()
  const project = projects.find((item) => item.id === user.project_id)
  if (!project) return { error: "The assigned project is no longer available.", message: null }

  let password = ""
  try {
    password = savedPassword(user)
  } catch (openError) {
    return { error: openError instanceof Error ? openError.message : "The saved password cannot be read.", message: null }
  }

  const recipient = user.email || (EMAIL.test(user.login_id) ? user.login_id : "")
  if (!recipient) return { error: "This account has no email to reply to.", message: null }

  try {
    await emailCredentials({
      to: recipient,
      loginId: user.login_id,
      password,
      projectName: project.name,
      projectAddress: project.address,
      subject: "Your Fibre Construction login",
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The email could not be sent.", message: null }
  }

  return {
    error: null,
    message: "We emailed the user ID and password. The project view stays the same.",
  }
}

export async function sendTestEmail(): Promise<UserFormState> {
  await requireAdmin()
  try {
    const transport = await sendOfficeCopy({
      to: ADMIN_INBOX,
      cc: OFFICE_CC,
      subject: "Fibre Construction mail test",
      text: "This is a test from the expense tracker. Signup and approval mail can use this inbox.",
    })
    const via = transport === "edge" ? "the Supabase mail function" : "the office mailbox directly"
    return { error: null, message: `Test email sent to ${ADMIN_INBOX} with a copy to ${OFFICE_CC} through ${via}.` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The test email failed.", message: null }
  }
}

async function finishCredentials(input: {
  userId: string
  to: string | null
  loginId: string
  password: string
  project: ProjectChoice | null
  subject: string
  success: string
}): Promise<UserFormState> {
  try {
    await emailCredentials({
      to: input.to,
      loginId: input.loginId,
      password: input.password,
      projectName: input.project?.name ?? "Full office access",
      projectAddress: input.project?.address ?? "Admin login for the whole tracker",
      subject: input.subject,
    })
  } catch (error) {
    revalidatePath("/users")
    const reason = error instanceof Error ? error.message : "Email failed."
    return {
      error: `The account was saved, but the email did not send. ${reason} Password: ${input.password}`,
      message: null,
    }
  }
  revalidatePath("/users")
  return { error: null, message: input.success }
}

async function dropOtherSessions(userId: string) {
  const current = await getAdminUser()
  if (current?.id === userId) return
  const admin = createAdminClient()
  await admin.from("app_sessions").delete().eq("user_id", userId)
}

function duplicateMessage(message: string) {
  if (/app_users_login_id_key|duplicate key/i.test(message) && /login_id/i.test(message)) {
    return "That user ID is already in use."
  }
  if (/app_users_email_key|duplicate key/i.test(message)) return "That email is already in use."
  return message
}

export type UsersPageData = Awaited<ReturnType<typeof loadUsersPage>>
