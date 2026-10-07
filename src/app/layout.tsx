import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";

import { AppProviders } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "Fibre Construction",
    template: "%s · Fibre Construction",
  },
  description: "Construction project expenses, receipts, and invoices.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const headerList = await headers()
  const zainab = headerList.get("x-fibre-view") === "zainab"
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <AppProviders zainab={zainab}>{children}</AppProviders>
      </body>
    </html>
  );
}
