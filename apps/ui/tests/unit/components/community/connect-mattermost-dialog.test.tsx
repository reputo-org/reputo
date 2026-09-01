// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ConnectMattermostDialog } from "@/components/community/connect-mattermost-dialog"

const validateMutateAsync = vi.fn()
const connectMutateAsync = vi.fn()
let validatePending = false

vi.mock("@/lib/api/hooks", () => ({
  useValidateMattermostConnection: () => ({
    isPending: validatePending,
    mutateAsync: validateMutateAsync,
  }),
  useConnectMattermostConnection: () => ({
    isPending: false,
    mutateAsync: connectMutateAsync,
  }),
}))

const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: vi.fn() } }))

const TEAMS = [
  { id: "team-1", name: "snet", displayName: "SingularityNET" },
  { id: "team-2", name: "labs", displayName: "Labs" },
]

function renderDialog(
  props: Partial<Parameters<typeof ConnectMattermostDialog>[0]> = {}
) {
  const onOpenChange = vi.fn()
  render(
    <ConnectMattermostDialog open onOpenChange={onOpenChange} {...props} />
  )
  return { onOpenChange }
}

async function fillCredentials(serverUrl = "https://chat.example.com") {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText("Server URL"), serverUrl)
  await user.type(screen.getByLabelText("Bot token"), "the-token")
  return user
}

describe("ConnectMattermostDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validatePending = false
    validateMutateAsync.mockResolvedValue({ teams: TEAMS })
    connectMutateAsync.mockResolvedValue({ id: "c1", status: "active" })
  })

  it("masks the token field and never previews its value", () => {
    renderDialog()

    const token = screen.getByLabelText("Bot token")
    expect(token).toHaveAttribute("type", "password")
    expect(token).toHaveAttribute("autocomplete", "off")
  })

  it("validates client-side before sending anything", async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(await screen.findByText("Enter the server URL.")).toBeInTheDocument()
    expect(validateMutateAsync).not.toHaveBeenCalled()
  })

  it("discloses the team picker only after a successful validate", async () => {
    renderDialog()
    expect(screen.queryByText("Team")).not.toBeInTheDocument()
    const user = await fillCredentials()

    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(await screen.findByText("Team")).toBeInTheDocument()
    expect(validateMutateAsync).toHaveBeenCalledWith({
      serverUrl: "https://chat.example.com",
      token: "the-token",
    })
    expect(connectMutateAsync).not.toHaveBeenCalled()
  })

  it("connects the picked team and closes with a success toast", async () => {
    const { onOpenChange } = renderDialog()
    const user = await fillCredentials()
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await screen.findByText("Team")

    await user.click(screen.getByRole("combobox"))
    await user.click(await screen.findByRole("option", { name: "Labs" }))
    await user.click(screen.getByRole("button", { name: "Connect" }))

    await waitFor(() =>
      expect(connectMutateAsync).toHaveBeenCalledWith({
        serverUrl: "https://chat.example.com",
        token: "the-token",
        teamId: "team-2",
      })
    )
    expect(toastSuccess).toHaveBeenCalledWith("Mattermost connected")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("maps a server reason code to prose instead of rendering the payload", async () => {
    validateMutateAsync.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: "outbound_policy" } },
      toJSON: () => ({}),
    })
    renderDialog()
    const user = await fillCredentials("https://10.0.0.8")

    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /public HTTPS hosts/
    )
    expect(screen.queryByText("Team")).not.toBeInTheDocument()
  })

  it("explains a token whose bot has no team", async () => {
    validateMutateAsync.mockResolvedValue({ teams: [] })
    renderDialog()
    const user = await fillCredentials()

    await user.click(screen.getByRole("button", { name: "Continue" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /not a member of any team/
    )
  })

  it("prefills the server URL on reconnect", () => {
    renderDialog({ initialServerUrl: "https://chat.example.com:8065" })

    expect(screen.getByLabelText("Server URL")).toHaveValue(
      "https://chat.example.com:8065"
    )
  })

  it("applies a prefill arriving after mount, as the card keeps the dialog mounted", () => {
    const onOpenChange = vi.fn()
    const { rerender } = render(
      <ConnectMattermostDialog open={false} onOpenChange={onOpenChange} />
    )

    rerender(
      <ConnectMattermostDialog
        open
        onOpenChange={onOpenChange}
        initialServerUrl="https://chat.example.com:8065"
      />
    )

    expect(screen.getByLabelText("Server URL")).toHaveValue(
      "https://chat.example.com:8065"
    )
  })
})
