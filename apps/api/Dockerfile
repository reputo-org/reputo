# syntax=docker/dockerfile:1
#
# Reusable per-app image. Builds are minimised via `turbo prune --docker`,
# which produces an isolated build context containing only the target app
# and its workspace dependencies.
#
# Usage:
#   docker buildx build --build-arg APP_NAME=api -f apps/api/Dockerfile .
#
ARG APP_NAME=api
ARG NODE_VERSION=22.20.0
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
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm exec turbo run build --filter="@reputo/${APP_NAME}..."
RUN pnpm deploy --filter="@reputo/${APP_NAME}" --prod /prod/app

# ---------- runtime ---------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /prod/app
COPY --from=builder /prod/app ./
EXPOSE 3000
CMD ["pnpm", "start"]
