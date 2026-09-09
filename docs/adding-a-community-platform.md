# Adding a community platform

Use this checklist to add a platform. Mattermost is the reference implementation. The shared dataset, cohort, and scoring pipeline do not change. Read [Community algorithms](community-algorithms.md) first.

## 1. Client and adapter (`packages/community-api`)

Create `src/<platform>/` with the same files as [`src/mattermost/`](../packages/community-api/src/mattermost): `client.ts` (connect-time calls), `adapter.ts`, `fetch.ts` (the crawl), `transform.ts` (payload to record mapping), `types.ts`, `index.ts`. Export it from `src/index.ts`.

The adapter implements `CommunityAdapter` from [`src/shared/records.ts`](../packages/community-api/src/shared/records.ts):

| Method | Job |
| --- | --- |
| `listResources(communityId)` | Every channel or repository with its read verdict (`readable`, `accessIssue`). |
| `probe(communityId)` | List resources, read one page from a readable one, return counts and display facts. Never content. |
| `iterateRecords(request)` | Stream one resource's window as canonical records with a resume cursor per batch. Return the resource coverage. |
| `searchMemberId(communityId, username)` | Exact username to account id, or `null`. |
| `searchMemberIds?(communityId, usernames)` | Optional bulk version. The cohort builder uses it when present. |

Follow these rules:

- Throw typed errors from `src/shared/errors.ts` with a safe category.
- Never read or return message text.
- Send requests to admin-supplied URLs through `executeSafeRequest` in `src/shared/safe-fetch.ts`.
- Seal admin-supplied tokens with `src/shared/credentials.ts`.
- If the platform sends live changes, add a source that follows `src/shared/realtime.ts`. Use `src/mattermost/socket.ts` as an example.

## 2. Contracts (`packages/contracts`)

- Add the platform to `CommunityPlatform` in `src/enums/community.ts`, plus any new resource kind or access issue.
- Add connect DTOs in `src/community/community-connection.dto.ts` if the connect flow needs a request body.

## 3. Registry (`packages/reputation-algorithms`)

- Add `<platform>-activity` to the dependency key enum in `src/shared/schema/algorithm-definition.schema.json`.
- Create `src/registry/<platform>_engagement/1.0.0.json` from the Mattermost file: the `community_connection` input with `uiHint.platform`, the `community_resources` input with `dependsOn`, `lookback_days`, and the `activities` repeater with the platform's activity enum and recommended settings.
- Run `pnpm algorithm:validate`.

## 4. Workflows (`apps/workflows`)

- `src/shared/types/dependency.types.ts`: add the dependency key and its platform to `COMMUNITY_PLATFORM_BY_DEPENDENCY_KEY`.
- `src/activities/community/dependency.activities.ts`: add the adapter case. Open sealed credentials through `src/activities/community/credentials.ts` when the platform uses a token.
- `src/activities/typescript/algorithms/<platform>-engagement/compute.ts`: a thin wrapper over `computeCommunityEngagement` with the activity order and, for chat platforms, the `active_day` config. Export it from the algorithms barrel and register it in `dispatchAlgorithm.activity.ts` and in the `custom-score` standalone registry.
- Add the score type to the lists in `deep-id-post-scores.activities.ts` and `deep-id-submit-custom-scores.activities.ts`, and to `@reputo/deep-id-api` scopes.

## 5. API (`apps/api`)

- `src/community/community-platform.registry.ts`: the platform client entry (list resources, probe, revoke).
- `src/community/community.controller.ts` and `community.service.ts`: the connect flow. OAuth install (Discord, GitHub) or token mode (Mattermost).
- `src/community/realtime/`: the feed source and its reconcile logic.
- `src/config/env.ts` and `community.config.ts`: the variables.

Preset validation needs nothing: it reads resources through the registry.

## 6. UI (`apps/ui`)

- `src/lib/community/platforms.ts`: platform label, resource noun, access rule, access issue copy, connect error copy.
- `src/components/community/platform-logo.tsx`: the brand mark.
- `src/core/preset-groups.ts`: the input groups for the new algorithm. `src/core/algorithms.ts`: the dependency label.
- A connect dialog like `connect-mattermost-dialog.tsx` for token-mode platforms.

## 7. Configuration

Add every variable to all four sources listed in [Environment variables](environment-variables.md), the `apps` stack only. Document the operator steps in [Community platform setup](community-platform-setup.md).

## 8. Tests

Follow the Mattermost test set:

- `packages/community-api/tests/unit/<platform>/`: client, transform, fetch, records, and socket event mapping.
- `apps/workflows/tests/e2e/algorithms/<platform>-engagement.e2e.test.ts`: the frozen dataset replays to byte-identical outputs. `tests/e2e/community/<platform>-dataset.e2e.test.ts`: the fetch and freeze. Use `sharedUndiciModuleMock()` from `tests/e2e/utils/community-mocks.ts`; every community e2e file must install the same mock.
- `apps/api/tests/e2e/community/<platform>-connections.test.ts` and the realtime tests.
- `apps/ui/tests/unit`: the connect dialog, the platform copy, and the composer fields.
