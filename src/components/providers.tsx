"use client"

import { ThemeProvider } from "next-themes"

import { Toaster } from "@/components/ui/sonner"
import { ViewModeProvider, ZainabLinkGuard } from "@/components/view-mode"

export function AppProviders({
  children,
  zainab,
}: {
  children: React.ReactNode
  zainab: boolean
}) {
  return (
    <ViewModeProvider zainab={zainab}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        disableTransitionOnChange
      >
        {children}
        <ZainabLinkGuard />
        <Toaster position="top-right" />
      </ThemeProvider>
    </ViewModeProvider>
  )
}
