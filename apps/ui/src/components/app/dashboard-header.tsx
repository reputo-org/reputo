"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserMenu } from "@/components/app/user-menu"
import { useAuthSession } from "@/lib/auth/auth-context"
import { cn } from "@/lib/utils"

interface NavItem {
  href: string
  label: string
  ownerOnly?: boolean
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/admins", label: "Admins", ownerOnly: true },
]

export function DashboardHeader() {
  const pathname = usePathname()
  const { session } = useAuthSession()
  const isOwner = session?.user?.role === "owner"

  const visibleNav = NAV_ITEMS.filter((item) => !item.ownerOnly || isOwner)

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-6">
          <Link href="/dashboard" className="text-lg font-semibold">
            Reputo
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-1">
            {visibleNav.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
        <UserMenu />
      </div>
    </header>
  )
}
