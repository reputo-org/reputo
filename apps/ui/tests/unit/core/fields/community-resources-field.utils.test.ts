import { describe, expect, it } from "vitest"
import {
  buildResourcePickerModel,
  displayResourceName,
  normalizeResourceSelection,
} from "@/core/fields/community-resources-field.utils"
import type { CommunityResourceDto } from "@/lib/api/types"

const RESOURCES: CommunityResourceDto[] = [
  { id: "c1", name: "general", kind: "text", readable: true },
  { id: "c2", name: "dev-forum", kind: "forum", readable: true },
  {
    id: "c3",
    name: "staff",
    kind: "text",
    readable: false,
    accessIssue: "missing_read_history",
  },
]

describe("displayResourceName", () => {
  it("keeps the channel convention and leaves repositories bare", () => {
    expect(displayResourceName({ name: "general", kind: "text" })).toBe(
      "#general"
    )
    expect(
      displayResourceName({ name: "snet/reputo", kind: "repository" })
    ).toBe("snet/reputo")
  })
})

describe("normalizeResourceSelection", () => {
  it("keeps string ids and drops everything else", () => {
    expect(normalizeResourceSelection(["c1", 7, null, "c2"])).toEqual([
      "c1",
      "c2",
    ])
    expect(normalizeResourceSelection("c1")).toEqual([])
    expect(normalizeResourceSelection(undefined)).toEqual([])
  })
})

describe("buildResourcePickerModel", () => {
  it("splits the listing by verdict and counts the selection", () => {
    const model = buildResourcePickerModel({
      resources: RESOURCES,
      selected: ["c2"],
      search: "",
    })

    expect(model.readable.map((row) => row.label)).toEqual([
      "#general",
      "#dev-forum",
    ])
    expect(model.unreadable).toEqual([
      {
        id: "c3",
        label: "#staff",
        kind: "text",
        readable: false,
        accessIssue: "missing_read_history",
        selected: false,
      },
    ])
    expect(model.readableIds).toEqual(["c1", "c2"])
    expect(model.counts).toEqual({ total: 3, readable: 2, selected: 1 })
    expect(model.unavailable).toEqual([])
    expect(model.selectedUnreadable).toEqual([])
  })

  it("filters both groups by label or id, case-insensitively, but never the selection facts", () => {
    const model = buildResourcePickerModel({
      resources: RESOURCES,
      selected: ["c1", "c3"],
      search: "STAFF",
    })

    expect(model.readable).toEqual([])
    expect(model.unreadable.map((row) => row.id)).toEqual(["c3"])
    expect(model.selectedUnreadable.map((row) => row.id)).toEqual(["c3"])
    expect(model.counts.selected).toBe(2)
    expect(
      buildResourcePickerModel({
        resources: RESOURCES,
        selected: [],
        search: "c2",
      }).readable.map((row) => row.id)
    ).toEqual(["c2"])
  })

  it("reports selected ids the listing no longer carries", () => {
    const model = buildResourcePickerModel({
      resources: RESOURCES,
      selected: ["c1", "deleted"],
      search: "",
    })

    expect(model.unavailable).toEqual(["deleted"])
  })
})
