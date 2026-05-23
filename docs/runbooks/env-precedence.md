# Env precedence

This runbook is the placeholder owned by milestone 9 task 10 ("Naming / value /
example cleanups"). It will be expanded into a full precedence table covering
container runtime env, `env_file:` references, per-app `.env` files, and Joi
schema defaults. Until then, only the preview-secret handling is documented
below.

## Preview deploy secrets

The `pullpreview` workflow (`.github/workflows/pull-preview.yml`) does **not**
write a combined `docker/compose/.env` file on the runner. Instead, each secret
is written to its own file under `docker/compose/secrets/`, mounted into the
target containers via Docker Compose [`secrets:`][compose-secrets], and exported
into the container's process env by the service `command:` wrapper before
`exec`'ing the app. The end result is:

- App code keeps reading `process.env.<VAR>` — no contract change.
- Values never appear in `environment:`, so `docker inspect <container>` does
  not reveal them.
- `docker/compose/secrets/` is gitignored; the directory only exists on the CI
  runner and on the preview host that the runner rsyncs to.

### Secret names

| Secret file (`/run/secrets/<name>`) | GitHub Actions secret      | Exported as              | Consumers                                       |
| ----------------------------------- | -------------------------- | ------------------------ | ----------------------------------------------- |
| `aws_access_key_id`                 | `AWS_ACCESS_KEY_ID`        | `AWS_ACCESS_KEY_ID`      | `api`, `orchestrator-worker`, `onchain-data-worker`, `typescript-worker` |
| `aws_secret_access_key`             | `AWS_SECRET_ACCESS_KEY`    | `AWS_SECRET_ACCESS_KEY`  | `api`, `orchestrator-worker`, `onchain-data-worker`, `typescript-worker` |
| `alchemy_api_key`                   | `ALCHEMY_API_KEY`          | `ALCHEMY_API_KEY`        | `orchestrator-worker`, `onchain-data-worker`, `typescript-worker`        |
| `deepfunding_api_key`               | `DEEPFUNDING_API_KEY`      | `DEEPFUNDING_API_KEY`    | `orchestrator-worker`, `onchain-data-worker`, `typescript-worker`        |

`PREVIEW_IMAGE_TAG` is substituted into `docker/compose/preview.yml` by `sed`
in the workflow before rsync — it is not a secret and is not routed through
the `secrets:` mechanism.

### Verifying after a preview deploy

```sh
docker inspect api orchestrator-worker onchain-data-worker typescript-worker \
  | jq '.[] | {name: .Name, env: .Config.Env}'
```

No `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `ALCHEMY_API_KEY`, or
`DEEPFUNDING_API_KEY` lines should appear.

[compose-secrets]: https://docs.docker.com/compose/how-tos/use-secrets/
