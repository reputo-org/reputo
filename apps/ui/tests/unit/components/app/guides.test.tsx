// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { Guides } from "@/components/app/guides/guides"
import { GUIDES, getGuidesByGroup, guideEmbedUrl } from "@/lib/guides"

describe("Guides", () => {
  it("lists every guide under its group and shows the first one", () => {
    render(<Guides />)

    for (const { group, guides } of getGuidesByGroup()) {
      expect(
        screen.getByRole("heading", { name: group.title })
      ).toBeInTheDocument()
      for (const guide of guides) {
        expect(
          screen.getByRole("button", { name: guide.title })
        ).toBeInTheDocument()
      }
    }

    expect(screen.getByTitle(GUIDES[0].title)).toHaveAttribute(
      "src",
      guideEmbedUrl(GUIDES[0].slug)
    )
  })

  it("switches the viewer when another guide is chosen", async () => {
    render(<Guides />)
    const target = GUIDES[GUIDES.length - 1]

    await userEvent.click(screen.getByRole("button", { name: target.title }))

    expect(screen.getByTitle(target.title)).toHaveAttribute(
      "src",
      guideEmbedUrl(target.slug)
    )
    expect(screen.getByRole("button", { name: target.title })).toHaveAttribute(
      "aria-current",
      "page"
    )
  })

  it("leaves out groups that have no guide yet", () => {
    const shown = getGuidesByGroup()
      .map((entry) => entry.group.id)
      .sort()
    const used = [...new Set(GUIDES.map((guide) => guide.group))].sort()

    expect(shown).toEqual(used)
  })
})
