// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent, { PointerEventsCheckLevel } from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { UserMenu } from "@/components/app/user-menu"
import type { AuthSession } from "@/lib/auth/auth-context"
import { useAuthSession } from "@/lib/auth/auth-context"

vi.mock("@/lib/auth/auth-context", () => ({
  useAuthSession: vi.fn(),
}))

const useAuthSessionMock = vi.mocked(useAuthSession)

const session: AuthSession = {
  authenticated: true,
  role: "admin",
  user: {
    id: "user-1",
    provider: "google",
    role: "admin",
    sub: "google|123",
    username: "alice",
    email: "alice@example.com",
  },
}

describe("UserMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders only a skeleton while the session is loading", () => {
    useAuthSessionMock.mockReturnValue({
      session: null,
      loading: true,
      logout: vi.fn(),
    })

    render(<UserMenu />)

    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it("shows the user's initials once authenticated", async () => {
    useAuthSessionMock.mockReturnValue({
      session,
      loading: false,
      logout: vi.fn(),
    })

    render(<UserMenu />)

    expect(await screen.findByText("A")).toBeInTheDocument()
  })

  it("opens the menu and calls logout when 'Log out' is clicked", async () => {
    const logout = vi.fn().mockResolvedValue(undefined)
    useAuthSessionMock.mockReturnValue({ session, loading: false, logout })

    const user = userEvent.setup({
      pointerEventsCheck: PointerEventsCheckLevel.Never,
    })
    render(<UserMenu />)

    await user.click(screen.getByRole("button"))

    expect(await screen.findByText("alice")).toBeInTheDocument()
    expect(screen.getByText("alice@example.com")).toBeInTheDocument()

    await user.click(await screen.findByRole("menuitem", { name: /log out/i }))

    expect(logout).toHaveBeenCalledTimes(1)
  })
})
