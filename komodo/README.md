# Komodo Operations

Komodo is the staging and production deployment control plane for Reputo. Core
runs on the dedicated host at `https://komodo.logid.xyz`; staging and production
run Periphery agents that execute the declared Compose stacks on each target
host.

```text
GitHub Actions -> GHCR image tags -> Komodo webhooks -> Periphery -> Docker Compose
```

## Host Shape

- Dedicated VM for Komodo Core, separate from staging and production.
- Minimum size: 1 vCPU / 2 GB RAM.
- Docker Engine with the Compose plugin.
- Ports `80/tcp` and `443/tcp` open to the internet.
- Cloudflare DNS record `komodo.logid.xyz` points to the VM public IP.

## Files

- `core/docker-compose.komodo.yml` runs Traefik, Komodo Core, FerretDB,
  Postgres, and a self-Periphery agent.
- `core/core.env.example` is the non-secret template. Copy it to
  `core/core.env` on the host and fill values from the password manager.
- `periphery/install.sh` installs the Periphery agent on staging and
  production hosts.
- `resources/` contains the declarative ResourceSync input for servers, stacks,
  procedures, alerters, schedules, and UserGroups.

Komodo's Postgres-backed mode runs FerretDB in front of Postgres so Core can
talk to a Postgres-backed metadata store through its native document-DB driver.

## Core Deploy

On the dedicated VM:

```bash
mkdir -p /opt/reputo
cd /opt/reputo

# Get this repository onto the host, then:
cp komodo/core/core.env.example komodo/core/core.env
chmod 600 komodo/core/core.env

# Edit core.env and replace every CHANGE_ME value from the password manager.
sudo mkdir -p \
  /etc/komodo/traefik/certs \
  /etc/komodo/core/data/postgres \
  /etc/komodo/core/data/ferretdb-state \
  /etc/komodo/core/data/keys \
  /etc/komodo/core/data/syncs \
  /etc/komodo/core/data/repo-cache \
  /etc/komodo/core/backups

# FerretDB runs as UID/GID 1000 and must be able to write /state/state.json.
sudo chown -R 1000:1000 /etc/komodo/core/data/ferretdb-state

sudo touch /etc/komodo/traefik/certs/cloudflare-acme.json
sudo chmod 600 /etc/komodo/traefik/certs/cloudflare-acme.json

docker compose \
  -f komodo/core/docker-compose.komodo.yml \
  --env-file komodo/core/core.env \
  up -d
```

## Periphery Install

Run this on staging and production hosts:

```bash
cp komodo/periphery/periphery.env.example komodo/periphery/periphery.env
chmod 600 komodo/periphery/periphery.env

# Edit periphery.env:
# - KOMODO_PASSKEY: same value as Core's KOMODO_PASSKEY
# - PERIPHERY_ALLOWED_IPS: Core IP /32 or VPN CIDR
# - PERIPHERY_PUBLISH_IP: private/VPN host IP reachable from Core

komodo/periphery/install.sh --env-file komodo/periphery/periphery.env
```

Register each host in the Komodo UI:

- Server name: `staging` or `production`
- Address: `http://<PERIPHERY_PUBLISH_IP>:8120` when
  `PERIPHERY_SSL_ENABLED=false`
- Auth/passkey: the same `KOMODO_PASSKEY` used by Core and Periphery

Verification commands on the target host:

```bash
docker compose \
  -f /etc/komodo/periphery/docker-compose.yml \
  --env-file /etc/komodo/periphery/periphery.env \
  ps

docker restart komodo-periphery
sleep 30
docker ps --filter name=komodo-periphery --format '{{.Names}} {{.Status}}'
ss -ltnp | grep ':8120'
```

From a network that is not Core or the VPN, `nc -vz <host-public-ip> 8120`
must fail. Use the host/cloud firewall or private/VPN routing to make the port
unreachable from the public internet; `PERIPHERY_ALLOWED_IPS` is defense in
depth, not the public exposure control.

## Resource Sync

Core syncs `komodo/resources` from the `main` branch through the `reputo-main`
ResourceSync in `resources/_sync.toml`.

After merging resource changes:

1. Open Komodo Core.
2. Go to `Resources > Resource Syncs > reputo-main`.
3. Review the pending diff.
4. Execute the sync.

The sync includes UserGroups. Apply the RBAC resources after cutover, then add
or remove individual users from groups in Komodo. User identities are not
hard-coded in this repository.

Application and infra Stacks also source their Compose files from the public
`reputo-org/reputo` GitHub repo on `main`; target hosts do not need a managed
`/opt/reputo` checkout for normal staging or production deploys.

## RBAC

Configured UserGroups:

- `admins`: write access on managed Reputo Servers, Stacks, Procedures,
  Alerters, and ResourceSyncs. Komodo's platform admin flag is still managed by
  a super admin in the UI.
- `engineers`: read on production resources and execute on staging stacks.
- `release-managers`: execute on the `promote-production` Procedure and read
  the production app stack.

Verification:

1. Add a test user to `engineers`.
2. Confirm they can execute `reputo-apps-staging`.
3. Confirm they can read `reputo-apps-production`.
4. Confirm they cannot execute `promote-production`.
5. Add a test user to `release-managers`.
6. Confirm they can execute `promote-production`.

## Deploy Staging

Normal path:

1. Merge to `main`.
2. GitHub Actions builds affected deployable apps.
3. The build publishes immutable `sha-<commit>` tags and updates the mutable
   `staging` tag for affected apps.
4. The `main` workflow calls the `reputo-apps-staging` Stack webhook.
5. Komodo updates its Git checkout, pulls the changed images, and deploys
   `docker/compose/apps.yml` on the staging host.

Manual path:

1. Open `Stacks > reputo-apps-staging` in Komodo.
2. Confirm `IMAGE_TAG=staging` in the generated environment.
3. Select `Deploy`.
4. Verify the stack events, container status, and `https://staging.logid.xyz`.

## Promote Production

Normal path:

1. Open GitHub Actions and run `Promote to Production`.
2. Enter the commit SHA whose `sha-<commit>` images should be promoted.
3. The workflow resolves available app images, retags their digests to
   `production` and `prod-<commit>`, then calls the `promote-production`
   Procedure webhook.
4. Komodo deploys `reputo-apps-production` with `IMAGE_TAG=production`.
5. Verify the Komodo Procedure run, stack events, and `https://logid.xyz`.

Direct production Stack webhooks are disabled; production deploys go through
the `promote-production` Procedure.

Manual path for release managers:

1. Confirm the desired images already have the `production` tag in GHCR.
2. Open `Procedures > promote-production` in Komodo.
3. Select `Run`.
4. Verify the production app stack deploy completed successfully.

## Roll Back

Staging rollback:

1. Identify the previous known-good commit SHA.
2. Retag the affected app images from `sha-<commit>` back to `staging` in GHCR.
3. Run `Stacks > reputo-apps-staging > Deploy` in Komodo.
4. Verify staging health and stack events.

Production rollback:

1. Identify the previous known-good commit SHA.
2. Run the `Promote to Production` GitHub Actions workflow with that SHA.
3. Verify the workflow retagged the affected images and called Komodo.
4. Verify the `promote-production` Procedure and production stack events.

## Add A New Server

1. Install Docker Engine and the Compose plugin on the target host.
2. Create or confirm the private/VPN path from Komodo Core to the host.
3. Copy `komodo/periphery/periphery.env.example` to `periphery.env`, fill the
   passkey and network values from the password manager, and run
   `komodo/periphery/install.sh`.
4. Add the server to `komodo/resources/servers.toml` with an `env:<name>` tag
   and a `[[<ENV>_PERIPHERY_ADDRESS]]` variable reference.
5. Add any required Stack resources under `komodo/resources/stacks/`.
6. Add the corresponding Komodo variables and secrets.
7. Merge, sync `reputo-main`, and verify the server is reachable.

## Add A New Secret

1. Create the secret in Komodo under `Settings > Variables`.
2. Use a clear environment prefix, for example `STAGING_<NAME>` and
   `PRODUCTION_<NAME>`.
3. Reference it in the relevant stack `environment` block as `[[SECRET_NAME]]`.
4. Wire it into the Compose service with an explicit `environment` entry.
5. Merge, sync `reputo-main`, deploy the affected stack, and verify without
   printing the secret value in logs.

For non-secret runtime values, use the same environment prefix convention and
create visible Komodo variables. Do not reintroduce prod/staging dependencies
on host-local `docker/env/*.env` files; the Git-sourced stack clone does not
contain those gitignored files.

## Backup

Include these host paths in the VM backup policy:

- `/etc/komodo/core/data/postgres`
- `/etc/komodo/core/backups`
- `/etc/komodo/core/data/keys`
- `/etc/komodo/traefik/certs`

Komodo v1.19+ creates a daily "Backup Core Database" procedure on new installs
when init resources are enabled. The Core container mounts
`/etc/komodo/core/backups` to `/backups` for those logical backups.

For an explicit Postgres dump:

```bash
docker compose \
  -f komodo/core/docker-compose.komodo.yml \
  --env-file komodo/core/core.env \
  --profile backup \
  run --rm postgres-backup
```

## Verification

```bash
docker compose \
  -f komodo/core/docker-compose.komodo.yml \
  --env-file komodo/core/core.env \
  ps

curl -I https://komodo.logid.xyz/
```

Expected checks:

- `https://komodo.logid.xyz/` presents a valid Cloudflare/Let's Encrypt TLS
  certificate from Traefik.
- A fresh browser can complete GitHub OAuth login.
- The first successful login is enabled as the initial admin.
- Restarting `komodo-core` preserves users, sessions, and resources.
- Power-cycling the VM brings Traefik, Postgres, FerretDB, Core, and Periphery
  back up with `restart: unless-stopped`.
- The webhook secret in `core.env` matches the GitHub staging and production
  environment secrets.
