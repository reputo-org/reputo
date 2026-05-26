# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.20.0

FROM node:${NODE_VERSION}-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /workspace

COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

CMD ["pnpm", "--version"]
