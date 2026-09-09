/**
 * Registry of the published Scribe walkthroughs. One source of truth for the
 * Guides page, the login page, and docs/guides.md.
 */

export type GuideGroupId = "communities" | "presets" | "admin"

export interface GuideGroup {
  id: GuideGroupId
  title: string
}

export const GUIDE_GROUPS: readonly GuideGroup[] = [
  { id: "communities", title: "Communities" },
  { id: "presets", title: "Presets and snapshots" },
  { id: "admin", title: "Admin" },
]

export type GuideId =
  | "connect-discord"
  | "connect-github"
  | "connect-mattermost"
  | "fix-connection"
  | "create-preset"
  | "community-preset"
  | "custom-score-preset"
  | "run-snapshot"
  | "manage-access"

export interface Guide {
  id: GuideId
  group: GuideGroupId
  /** Full title used for the list, links, and the iframe title. */
  title: string
  /** Scribe shared id. */
  slug: string
}

export const GUIDES: readonly Guide[] = [
  {
    id: "connect-discord",
    group: "communities",
    title: "How to connect a Discord server",
    slug: "How_to_connect_a_Discord_server__imMuCR12S2GUeHAvdUs4Eg",
  },
  {
    id: "connect-github",
    group: "communities",
    title: "How to connect a GitHub organization",
    slug: "How_to_connect_a_GitHub_organization__dHnSsiH_RByqellstLMOMQ",
  },
  {
    id: "connect-mattermost",
    group: "communities",
    title: "How to connect a Mattermost team",
    slug: "How_to_connect_a_Mattermost_team__h9jnn6YWRqeh6ItlxA91jA",
  },
  {
    id: "fix-connection",
    group: "communities",
    title: "How to fix a connection that needs attention",
    slug: "How_to_fix_a_connection_that_needs_attention__2LYKtVP-Qdqq_sl4iblaWw",
  },
  {
    id: "create-preset",
    group: "presets",
    title: "How to create a preset",
    slug: "How_to_create_a_preset__-vNXUCIUR0C_U_XxFaB4Eg",
  },
  {
    id: "community-preset",
    group: "presets",
    title: "How to create a community engagement preset",
    slug: "How_to_create_a_community_engagement_preset__vO6ivxj1RlatnLMlrLy7qQ",
  },
  {
    id: "custom-score-preset",
    group: "presets",
    title: "How to create a Custom Score preset",
    slug: "How_to_create_a_Custom_Score_preset__jMWLl6zAQ2qaxR2sNtPNOg",
  },
  {
    id: "run-snapshot",
    group: "presets",
    title: "How to run a snapshot and read the results",
    slug: "How_to_run_a_snapshot_and_read_the_results__JuxsjHe_TRSKaJMd-SB7JQ",
  },
  {
    id: "manage-access",
    group: "admin",
    title: "How to manage admin access",
    slug: "How_to_manage_admin_access__DwkGUe2USke7lSTL4LifMA",
  },
]

export function getGuide(id: GuideId): Guide {
  const guide = GUIDES.find((g) => g.id === id)
  if (!guide) throw new Error(`Unknown guide: ${id}`)
  return guide
}

/** Groups in display order, without the ones that have no guide yet. */
export function getGuidesByGroup(): { group: GuideGroup; guides: Guide[] }[] {
  return GUIDE_GROUPS.map((group) => ({
    group,
    guides: GUIDES.filter((guide) => guide.group === group.id),
  })).filter((entry) => entry.guides.length > 0)
}

/** Full-page, shareable viewer URL (public, no Scribe account needed). */
export function guideViewerUrl(slug: string): string {
  return `https://scribehow.com/viewer/${slug}`
}

/** Inline embed URL for an <iframe>. */
export function guideEmbedUrl(slug: string): string {
  return `https://scribehow.com/embed/${slug}`
}
