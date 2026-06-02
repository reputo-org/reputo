# @reputo/deepfunding-portal-api

Client for the DeepFunding Portal API plus an ingest layer that persists the fetched data to a local
SQLite database (TypeORM + better-sqlite3).

It exists to pull DeepFunding proposal, voting, and contribution data into a queryable local store
that reputation algorithms read from.

Public API is `src/index.ts`; HTTP client in `src/api`, persistence in `src/db`, fetchers in `src/resources`.
