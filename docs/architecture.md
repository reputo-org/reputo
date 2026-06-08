# Architecture

A high-level map of how Reputo fits together: the apps, the data stores, and how a
reputation snapshot flows through the system. For the workspace list and import rules see
[Monorepo structure](monorepo-structure.md); for the database tables see
[Data model](data-model.md).

## What Reputo is

Reputo is a privacy-preserving reputation platform. A user picks a reputation
**algorithm**, saves a configured **preset**, and starts a **snapshot**. Temporal workers
compute the score off the request path and store the result, which the API and UI surface.

It is three apps — a NestJS API, a Next.js UI, and Temporal workers — plus six shared
packages. See [Monorepo structure](monorepo-structure.md) for the full list.

Traefik sits in front of the UI and API and terminates TLS.

## Snapshot lifecycle

1. The user configures a preset and starts a snapshot in the UI.
2. The API creates a `snapshots` row with status `queued` and **freezes** the preset (a
   JSON copy), so later edits do not change a running snapshot.
3. The API starts the Temporal orchestrator workflow for that snapshot.
4. The orchestrator marks the snapshot `running`, resolves any data dependencies (on-chain
   transfers, portal data), and runs the selected algorithm on the matching worker.
5. Results are stored: per-key scores in `snapshot_outputs`, and large artifacts in object
   storage.
6. Each status change is written to Postgres and announced with `pg_notify`. The API turns
   that into an SSE stream, so the UI updates live (`running` → `completed` or `failed`).

## Data stores

- **Application Postgres** — system of record for presets, snapshots, outputs, users,
  sessions, and the access allowlist. Owned by the API. See [Data model](data-model.md).
- **On-chain Postgres** — separate database for synced transfers.
- **Temporal** — its own cluster and database; holds workflow state and history.
- **Object storage (S3 / MinIO)** — preset input files and snapshot artifacts, served
  through presigned URLs.

## Identity and access

- Login uses **Deep ID** over OIDC with PKCE. The API stores an opaque session and keeps
  the provider tokens encrypted at rest.
- Access is gated by an **allowlist**: only emails with an `owner` or `admin` role can sign
  in. There is no open sign-up.

## Infrastructure and deployment

The platform runs as four Komodo stacks per environment — apps, database, Temporal, and
observability — behind Traefik with TLS. Images are built in GitHub Actions and published
to GHCR. See [Deployment](deployment.md), [Docker stack](docker.md),
[Komodo operations](komodo.md), and [Observability](observability.md).
