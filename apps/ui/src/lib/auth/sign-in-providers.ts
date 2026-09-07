import type { OAuthProviderId } from "@/lib/api/types"

/**
 * Per-provider sign-in metadata used to render the login page.
 *
 * Each provider maps to an `OAuthProviderId` handled by the backend.
 * To add a provider:
 *  1. Add the id to `OAUTH_PROVIDER_IDS` in `lib/api/types`.
 *  2. Add a brand mark to `components/providers/provider-logo`.
 *  3. Add an entry here with the login path.
 */
export interface SignInProviderConfig {
  id: OAuthProviderId
  ariaLabel: string
  loginPath: string
  /** Brand mark height in pixels rendered inside the button. */
  logoHeight: number
}

export const SIGN_IN_PROVIDERS: readonly SignInProviderConfig[] = [
  {
    id: "deep-id",
    ariaLabel: "Sign in with DeepID",
    loginPath: "/api/v1/auth/deep-id/login",
    logoHeight: 18,
  },
]
