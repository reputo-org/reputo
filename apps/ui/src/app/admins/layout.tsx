"use client"

import { DashboardHeader } from "@/components/app/dashboard-header"
import { AuthBootstrapProvider } from "@/lib/auth/auth-context"

export default function AdminsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthBootstrapProvider>
      <div className="min-h-screen w-full">
        <DashboardHeader />
        <main className="mx-auto w-full max-w-6xl px-6 py-8">{children}</main>
      </div>
    </AuthBootstrapProvider>
  )
}
