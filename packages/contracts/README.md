# @reputo/contracts

Types shared between the API (`apps/api`) and the workflow workers (`apps/workflows`). Plain TypeScript only, no framework dependencies.

## Main exports

- **Enums**: `SnapshotStatus`, `SnapshotPublicationStatus`, `OAuthProvider`, `AccessRole`, `CommunityPlatform`, `CommunityConnectionStatus`, `CommunityResourceKind`, `CommunityResourceAccessIssue`, `CommunityFeedState`.
- **DTOs**: `SnapshotDto`, `AlgorithmPresetFrozenDto`, the community connection and Mattermost connect DTOs, `CommunityConnectionEventDto`.
- **Temporal activity I/O**: the `ApiSnapshotActivities` interface (`getSnapshot`, `updateSnapshot`, `getCommunityConnection`, `getCommunitySealedCredential`, `checkCommunityConnectionHealth`, `recordSnapshotPublication`) and its input and output types.
- **Task-queue names**: `API_SNAPSHOT_ACTIVITIES_TASK_QUEUE`.

## Usage

```ts
import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE, SnapshotStatus, type SnapshotDto } from '@reputo/contracts';
```

## Rules

- No `@nestjs/*`, `typeorm`, or `@temporalio/*` runtime dependencies.
- Persistence types stay in the API.
- Workflows depend on this package only, never on `apps/api` internals.
- Import from `src/index.ts` only.

## Commands

```bash
pnpm --filter @reputo/contracts build
pnpm --filter @reputo/contracts test
pnpm --filter @reputo/contracts typecheck
pnpm --filter @reputo/contracts docs
```

## Related documentation

- [Architecture](../../docs/architecture.md)
- [Monorepo structure](../../docs/monorepo-structure.md)
