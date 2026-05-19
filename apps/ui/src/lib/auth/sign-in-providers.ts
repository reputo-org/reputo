import type { OAuthProviderId } from "@/lib/api/types"

/**
 * Per-provider sign-in metadata used to render the login page.
 *
 * Live providers map to an `OAuthProviderId` (the backend handles them).
 * "Soon" providers are render-only placeholders so the login page can hint
 * at upcoming options; their `label` doubles as the button text.
 *
 * To add a new live provider:
 *  1. Add the id to `OAUTH_PROVIDER_IDS` in `lib/api/types`.
 *  2. Add a brand mark to `components/providers/provider-logo`.
 *  3. Add an entry here with `status: "live"` and the login path.
 */
export type SignInProviderConfig = LiveSignInProvider | SoonSignInProvider

interface LiveSignInProvider {
  status: "live"
  /** Live providers correspond to a real OAuthProviderId. */
  id: OAuthProviderId
  ariaLabel: string
  loginPath: string
  /** Brand mark height in pixels rendered inside the button. */
  logoHeight: number
}

interface SoonSignInProvider {
  status: "soon"
  /**
   * Stable key for React, e.g. "google". Not a backend identifier — the
   * provider is not yet live.
   */
  id: string
  /** Display label used inside the disabled button (e.g. "Google"). */
  label: string
  ariaLabel: string
}

export const SIGN_IN_PROVIDERS: readonly SignInProviderConfig[] = [
  {
    status: "live",
    id: "deep-id",
    ariaLabel: "Continue with DeepID",
    loginPath: "/api/v1/auth/deep-id/login",
    logoHeight: 18,
  },
  {
    status: "soon",
    id: "google",
    label: "Google",
    ariaLabel: "Google sign-in (coming soon)",
  },
  {
    status: "soon",
    id: "github",
    label: "GitHub",
    ariaLabel: "GitHub sign-in (coming soon)",
  },
]
