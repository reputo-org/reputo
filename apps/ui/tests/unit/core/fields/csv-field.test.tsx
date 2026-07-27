// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useForm } from "react-hook-form"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { Form } from "@/components/ui/form"
import { CSVField } from "@/core/fields"
import { FormUploadProvider, useFormUpload } from "@/core/form-context"
import type { FormInput } from "@/core/schema-builder"

const { validateCSVContentMock } = vi.hoisted(() => ({
  validateCSVContentMock: vi.fn(),
}))

vi.mock("@reputo/algorithm-validator", () => ({
  validateCSVContent: validateCSVContentMock,
}))

vi.mock("@/lib/api/services", () => ({
  storageApi: {
    createUpload: vi.fn(),
    createDownload: vi.fn(),
  },
}))

const input: FormInput = {
  key: "votes",
  label: "Vote History (CSV)",
  type: "csv",
  required: true,
  csv: { hasHeader: true, delimiter: ",", columns: [] },
}

function UploadState() {
  const { isUploading } = useFormUpload()
  return <span data-testid="upload-state">{String(isUploading)}</span>
}

function Harness({ mounted }: { mounted: boolean }) {
  const form = useForm<any>({ defaultValues: { votes: "" } })

  return (
    <FormUploadProvider>
      <Form {...form}>
        <form>
          {mounted && <CSVField input={input} control={form.control} />}
          <UploadState />
        </form>
      </Form>
    </FormUploadProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("CSVField upload tracking", () => {
  it("clears its uploading flag when the field unmounts mid-validation", async () => {
    // Never resolves: the field stays busy for the whole test.
    validateCSVContentMock.mockReturnValue(new Promise(() => {}))

    const { container, rerender } = render(<Harness mounted={true} />)

    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement
    const file = new File(["did,score"], "votes.csv", { type: "text/csv" })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() =>
      expect(screen.getByTestId("upload-state")).toHaveTextContent("true")
    )

    // A composer row can be removed while its upload is still running.
    rerender(<Harness mounted={false} />)

    await waitFor(() =>
      expect(screen.getByTestId("upload-state")).toHaveTextContent("false")
    )
  })
})
