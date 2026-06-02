# @reputo/contracts

Cross-service wire types: enums, DTOs, Temporal activity I/O, and task-queue names.

It exists so `@reputo/api` and `@reputo/workflows` agree on the shapes they exchange without either
service importing the other. Types here are framework-agnostic and serializable because they cross
Temporal and HTTP boundaries.

Public API is `src/index.ts`; grouped under `src/{enums,snapshot,activities,temporal}`.
