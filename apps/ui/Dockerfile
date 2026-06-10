# syntax=docker/dockerfile:1
#
# Reusable per-app image. Builds are minimised via `turbo prune --docker`,
# which produces an isolated build context containing only the target app
# and its workspace dependencies. UI uses Next.js standalone output rather
# than `pnpm deploy` for the runtime layer.
#
# Usage:
#   docker buildx build --build-arg APP_NAME=ui -f apps/ui/Dockerfile .
#
ARG APP_NAME=ui
# Default mirrors mise.toml; CI passes the value parsed from mise.toml.
ARG NODE_VERSION=24.14.0
ARG TURBO_VERSION=2.9.6

# ---------- base ------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable
WORKDIR /repo

# ---------- pruner: produce isolated workspace for APP_NAME -----------------
FROM base AS pruner
ARG APP_NAME
ARG TURBO_VERSION
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm dlx turbo@${TURBO_VERSION} prune "@reputo/${APP_NAME}" --docker

# ---------- installer: install pruned deps ----------------------------------
# turbo prune rewrites pnpm-lock.yaml and drops the `settings` block, which
# clashes with `injectWorkspacePackages: true` in pnpm-workspace.yaml. Copy
# the original lockfile back over the pruned one — pnpm ignores entries that
# aren't referenced from the pruned package.json files.
FROM base AS installer
COPY --from=pruner /repo/out/json/ ./
COPY --from=pruner /repo/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------- builder: build APP_NAME and its deps ----------------------------
FROM installer AS builder
ARG APP_NAME
COPY --from=pruner /repo/out/full/ ./
# Next.js type-check pulls in apps/ui/vitest.config.ts which imports
# ../../vitest.base. turbo prune only captures workspace files, so this
# root-level file has to be copied in explicitly.
COPY --from=pruner /repo/vitest.base.ts ./vitest.base.ts
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm exec turbo run build --filter="@reputo/${APP_NAME}..."

# ---------- runtime: Next.js standalone -------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
# Apply Debian security updates the pinned base image may not carry yet.
RUN apt-get update && apt-get -y upgrade && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /repo/apps/ui/.next/standalone ./
COPY --from=builder /repo/apps/ui/.next/static ./apps/ui/.next/static
COPY --from=builder /repo/apps/ui/public ./apps/ui/public

# Build commit, kept for ops (docker inspect / process env).
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}

EXPOSE 8080
CMD ["node", "apps/ui/server.js"]
