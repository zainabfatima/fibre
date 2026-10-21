"use server"

import {
  createAccount,
  deleteAccount,
  emailSavedPassword,
  forgotPassword,
  requestSignup,
  reviewSignupRequest,
  saveAccount,
  sendTestEmail,
  type UserFormState,
} from "@/lib/user-accounts"

export type { UserFormState }

export async function submitSignup(_state: UserFormState, formData: FormData) {
  return requestSignup(formData)
}

export async function reviewSignup(_state: UserFormState, formData: FormData) {
  return reviewSignupRequest(formData)
}

export async function addAccount(_state: UserFormState, formData: FormData) {
  return createAccount(formData)
}

export async function updateAccount(_state: UserFormState, formData: FormData) {
  return saveAccount(formData)
}

export async function resendAccount(_state: UserFormState, formData: FormData) {
  return emailSavedPassword(formData)
}

export async function removeAccount(_state: UserFormState, formData: FormData) {
  return deleteAccount(formData)
}

export async function submitForgotPassword(_state: UserFormState, formData: FormData) {
  return forgotPassword(formData)
}

export async function submitTestEmail(_state: UserFormState) {
  return sendTestEmail()
}
