# Architecture

How the apps fit together, where data lives, and how a snapshot moves through the system. For the workspace list see [Monorepo structure](monorepo-structure.md). For the tables see [Data model](data-model.md).

## The parts

Reputo is three apps and eight shared packages. Traefik sits in front of the UI and API and terminates TLS.

| Part | Role |
| --- | --- |
| `@reputo/api` (NestJS) | HTTP API, the application database, community connections, and a Temporal worker for database activities. |
| `@reputo/ui` (Next.js) | The dashboard. Calls the API at `/api/v1` and follows changes over Server-Sent Events (SSE). |
| `@reputo/workflows` (Temporal) | Four workers: orchestrator, algorithm, onchain-data, and community. They compute snapshots off the request path. |

Workers never open the application database. They read and write snapshot rows through activities the API hosts on the `api-snapshot-activities` queue.

## Snapshot lifecycle

1. An admin saves a **preset** (an algorithm plus its inputs) and starts a **snapshot**.
2. The API creates a `snapshots` row with status `queued` and freezes a JSON copy of the preset. Later edits do not change a running snapshot.
3. The API starts the orchestrator workflow.
4. The orchestrator sets `running` and resolves the algorithm's data dependencies: consented users from DeepID, Deep Funding Portal data, on-chain transfers, or a frozen community dataset. Community fetches run one at a time on the community worker.
5. The algorithm worker computes the score and writes the results: a CSV with one row per user and a details JSON, stored in object storage and listed in `snapshot_outputs`.
6. The orchestrator posts the scores to DeepID and records the outcome in `snapshot_publications`. See [DeepID integration](deep-id-integration.md).
7. Every status change is written to Postgres and announced with `pg_notify`. The API turns that into SSE, so the UI updates live.

A snapshot always ends in `completed`, `failed`, or `cancelled`. If the workflow cannot start, the API marks the row `failed`. If a run is lost (timeout, terminate), a reconciler in the API checks queued and running rows against Temporal and settles them. The state machine is `queued → running → completed | failed | cancelled`, so a late write can never reopen a finished snapshot.

## Community connections

An admin connects a Discord server, a GitHub installation, or a Mattermost team. The API checks access and follows the platform's live events. Community algorithms read the selected channels or repositories when a snapshot starts. See [Community connections](community-connections.md) and [Community algorithms](community-algorithms.md).

## Data stores

| Store | Holds | Owner |
| --- | --- | --- |
| Application Postgres | Presets, snapshots, outputs, publications, users, sessions, the access allowlist, community connections | `@reputo/api` |
| On-chain Postgres | Synced token transfers | `@reputo/onchain-data` |
| Temporal | Workflow state and history | Temporal cluster |
| Object storage (S3 or MinIO) | Uploaded input files, snapshot results, community datasets. Served through presigned URLs. | `@reputo/storage` |

## Identity and access

- Admins sign in with **DeepID** over OIDC with PKCE. The API keeps an opaque session and stores the provider tokens encrypted.
- Access is an **allowlist** of emails with the role `owner` or `admin`. There is no self sign-up.
- Community members give **consent** in DeepID, not in Reputo. Consent covers wallets, scores, and the linked GitHub, Discord, and Mattermost usernames. See [Voting Portal integration](voting-portal-integration.md).

## Infrastructure

Staging and production each run four Komodo stacks: apps, database, Temporal, and observability. GitHub Actions builds the images once and publishes them to GHCR. See [Deployment](deployment.md), [Komodo operations](komodo.md), and [Observability](observability.md).
