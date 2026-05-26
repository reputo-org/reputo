# Migration plan

How to cut over from the previous `komodo/` + monolithic `docker/compose/compose.yml` setup to the new `infra/komodo/` four-stack layout.

> [!IMPORTANT]
> Persistent volumes are recreated from empty under new names. The old `reputo_postgres_data`, `reputo_onchain_data_postgresql_data`, `reputo_temporal_postgresql_data`, `reputo_temporal_elasticsearch_data`, `reputo_loki_data`, `reputo_prometheus_data`, and `reputo_grafana_data` volumes are abandoned. **Take a backup before cutover if any of that data is worth keeping.** If you need to preserve data, stop the migration and switch the new compose files to use `external: true` named volumes pointing at the old names.

## Scope

| Area | Change |
| --- | --- |
| Folder | `komodo/` → `infra/komodo/` |
| Stacks | 2 per env (`apps`, `infra`) → 4 per env (`database`, `temporal`, `observability`, `apps`) |
| Compose file | One `docker/compose/compose.yml` with profiles → four per-stack `infra/komodo/stacks/<name>/compose.yml` files |
| Compose project name | `reputo` for both stacks → `reputo-database`, `reputo-temporal`, `reputo-observability`, `reputo-apps` |
| Volumes | `reputo_*` → `<project>_*` (fresh, no data carry-over) |
| Shared network | name unchanged: `reputo` (was `production` in env files; periphery installer defaults align with `reputo` now) |
| Procedures | added `deploy-*`, `restart-apps-*`, `backup-data-*` |

## Pre-cutover

1. **Backup live data.** On each Periphery host:
   ```bash
   docker exec postgres pg_dumpall -U "$API_POSTGRES_USER" | gzip > /var/lib/reputo/backups/api-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
   docker exec onchain-data-postgresql pg_dumpall -U "$ONCHAIN_DATA_POSTGRES_USER" | gzip > /var/lib/reputo/backups/onchain-$(date -u +%Y%m%dT%H%M%SZ).sql.gz
   docker run --rm -v reputo_grafana_data:/src -v /var/lib/reputo/backups:/dst alpine \
       sh -c 'cd /src && tar czf /dst/grafana-$(date -u +%Y%m%dT%H%M%SZ).tgz .'
   ```
   Keep these somewhere off-host (S3, password manager attachments, etc.).
2. **Tag the current Komodo state.** Note down which images are deployed (`docker ps --format '{{.Image}}' | sort -u`) and the current `IMAGE_TAG` value for staging and production. You will need these if rollback is required.
3. **Stop the staging webhook from firing.** Either disable the `reputo-apps-staging` webhook in the Komodo UI temporarily, or freeze merges to `main` until cutover is complete.

## Cutover (per Periphery host: staging first, then production)

1. **Bring the old stacks down without removing volumes.**
   ```bash
   docker compose -p reputo -f /path/to/old/compose.yml --profile apps down
   docker compose -p reputo -f /path/to/old/compose.yml --profile infra --profile observability down
   ```
   This leaves `reputo_*` volumes on disk; you can return to them via [ROLLBACK.md](ROLLBACK.md).
2. **Reinstall periphery from the new tree.** The installer is idempotent and harmless if periphery is already running:
   ```bash
   git pull
   cp infra/komodo/periphery/periphery.env.example infra/komodo/periphery/periphery.env
   chmod 600 infra/komodo/periphery/periphery.env
   # edit values as needed
   sudo infra/komodo/periphery/install.sh --env-file infra/komodo/periphery/periphery.env
   ```
   The script creates the shared `reputo` bridge network if it does not exist.
3. **Prepare Traefik cert storage:**
   ```bash
   sudo mkdir -p /var/lib/reputo/traefik/certs
   sudo touch /var/lib/reputo/traefik/certs/cloudflare-acme.json
   sudo chmod 600 /var/lib/reputo/traefik/certs/cloudflare-acme.json
   ```
   This is the new `TRAEFIK_CERTS_PATH`. The old `docker/compose/certs/` is no longer mounted.

## Komodo UI steps

These are the only manual Komodo UI steps; everything else is declarative.

1. **Update the existing `reputo-main` ResourceSync to point at the new paths.**

   Komodo UI → `Resources > Resource Syncs > reputo-main > Config`:
   - `Resource Path`: replace `komodo/resources` with these four entries:
     - `infra/komodo/resource-sync.toml`
     - `infra/komodo/procedures.toml`
     - `infra/komodo/resources`
     - `infra/komodo/stacks`

   Save. Komodo re-reads from the new locations. After this, the sync becomes self-managing.

2. **Run the sync once.** Review the diff: 6 new stacks, 12 new procedures, updated user-group permissions, alerter and servers unchanged. Execute.

3. **Confirm the variables are unchanged.** The new stacks reference the same `STAGING_*` / `PRODUCTION_*` names. No new variables need to be added unless a new one was introduced in the same PR.

4. **Delete the old `reputo-apps-{env}` and `reputo-infra-{env}` stacks** in the Komodo UI. The new stacks replace them. The old ResourceSync had `delete = false` so the legacy stacks were left behind by the sync; remove them by hand.

5. **Deploy the four new stacks in order.** Use the `deploy-all-staging` procedure for staging, then validate, then `deploy-all-production`. Or step through them one at a time:
   1. `deploy-database-staging`
   2. `deploy-temporal-staging`
   3. `deploy-observability-staging`
   4. `deploy-apps-staging`

6. **Re-enable the staging stack webhook** if you disabled it in the pre-cutover step.

7. **Update GitHub secrets if needed.** No webhook URL change — `https://komodo.logid.xyz/listener/github/stack/reputo-apps-staging/deploy` and `https://komodo.logid.xyz/listener/github/procedure/promote-production/__ANY__` are unchanged.

## Validation after cutover

On each host:

```bash
docker network inspect reputo | jq '.[0].Containers | length'   # expect: every running app container
docker compose -p reputo-database ps
docker compose -p reputo-temporal ps
docker compose -p reputo-observability ps
docker compose -p reputo-apps ps
```

Smoke test:

- `curl -I https://<UI_DOMAIN>/` — TLS valid, 200/3xx.
- `curl -I https://<API_DOMAIN>/api/v1/health` — 200.
- Grafana login at `https://<GRAFANA_DOMAIN>/` succeeds with the admin user from `STAGING_GRAFANA_ADMIN_*` / `PRODUCTION_GRAFANA_ADMIN_*`.
- Temporal UI at `https://<TEMPORAL_UI_DOMAIN>/` shows the `default` namespace with at least one worker connected.
- A test Discord alert from Komodo arrives.

## Common issues

- **Traefik can't discover app containers.** Confirm `traefik.docker.network=reputo` is on every routed service and that the host network `reputo` exists. The traefik container must be on the same network.
- **API can't reach Postgres.** `DATABASE_URL` host is `postgres`, which resolves via the shared `reputo` network. If you renamed the network in `COMPOSE_NETWORK_NAME`, all four stacks must agree on the new name.
- **Backups procedure exits 0 but writes nothing.** Check `docker volume inspect reputo-database_backups` and the container's `/backups` mount. The output directory inside the container is `/backups/<UTC-timestamp>/`.

## Post-cutover cleanup

After staging and production are stable for at least 24 hours:

- Remove the legacy stacks from the Komodo UI (if not already removed above).
- Optional: `docker volume rm reputo_postgres_data reputo_onchain_data_postgresql_data reputo_temporal_postgresql_data reputo_temporal_elasticsearch_data reputo_loki_data reputo_prometheus_data reputo_grafana_data` on each host once you are confident the new volumes contain everything you need.
- Optional: tag the migration commit (`git tag komodo-cutover-$(date -u +%Y%m%d)`) so a rollback can be located fast.
