import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { Providers } from "@/components/providers"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Reputo",
  description: "Run your own reputation algorithms",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // Browser extensions and pre-hydration scripts (Scribe, Grammarly, password
    // managers) mutate <html>/<body> before React hydrates. <html> suppression is
    // dev-only: a constant `true` there breaks `next build --turbopack`
    // (/_not-found, Next 15.5), and production users do not run the recorder
    // extension, so it is not needed in prod. <body> suppression is always safe.
    <html
      lang="en"
      suppressHydrationWarning={process.env.NODE_ENV === "development"}
    >
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
