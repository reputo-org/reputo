/**
 * Registry of the published Scribe walkthroughs. One source of truth so the guide
 * page and the login page reference the same guides.
 */

export type GuideId =
  | "sign-in"
  | "create-preset"
  | "run-snapshot"
  | "manage-access"

export interface Guide {
  id: GuideId
  /** Short label for tabs. */
  label: string
  /** Full title used for links and the iframe title. */
  title: string
  /** Scribe shared id. */
  slug: string
}

export const GUIDES: readonly Guide[] = [
  {
    id: "sign-in",
    label: "Sign in",
    title: "How to sign in to Reputo",
    slug: "How_to_sign_in_to_Reputo__2M_KJIByTV6UUwz_4F9GOA",
  },
  {
    id: "create-preset",
    label: "Create a preset",
    title: "How to create an algorithm preset",
    slug: "How_to_create_a_algorithm_preset__p8JUc3kySOeKaiKFeFG3EQ",
  },
  {
    id: "run-snapshot",
    label: "Run a snapshot",
    title: "How to run a snapshot",
    slug: "How_to_run_a_snapshot__uYEM1qtURyGKKnndKFHsZg",
  },
  {
    id: "manage-access",
    label: "Manage access",
    title: "How to manage access (admins)",
    slug: "How_to_manage_access_admins__0AY7IhPfTpOPvK8x91lwag",
  },
]

export function getGuide(id: GuideId): Guide {
  const guide = GUIDES.find((g) => g.id === id)
  if (!guide) throw new Error(`Unknown guide: ${id}`)
  return guide
}

/** Full-page, shareable viewer URL (public, no Scribe account needed). */
export function guideViewerUrl(slug: string): string {
  return `https://scribehow.com/viewer/${slug}`
}

/** Inline embed URL for an <iframe>. */
export function guideEmbedUrl(slug: string): string {
  return `https://scribehow.com/embed/${slug}`
}
