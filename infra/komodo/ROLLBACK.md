# Rollback plan

How to revert if the cutover to `infra/komodo/` fails partway, or if a regression appears within the first 24 hours after migration.

## Decision tree

| Symptom | Action |
| --- | --- |
| Sync diff looks wrong but nothing is deployed yet | Skip execution. No rollback needed — the previous `komodo/resources/` tree still controls live state. |
| New stacks deployed, app fails to start, old volumes still on disk | [§ A. Same commit, redeploy old stacks](#a-same-commit-redeploy-old-stacks) |
| Migration commit merged, need to fully revert | [§ B. Revert the migration commit](#b-revert-the-migration-commit) |
| Lost data after old volumes were deleted | [§ C. Restore from pre-cutover backups](#c-restore-from-pre-cutover-backups) |

## A. Same commit, redeploy old stacks

The old `komodo/` resources are gone from this branch, so this path requires that you took the pre-cutover backup branch suggested in [MIGRATION.md](MIGRATION.md), **or** that you can `git revert` the migration commit cleanly.

1. **Stop the new stacks** on each Periphery host, leaving their volumes in place:
   ```bash
   docker compose -p reputo-apps -f /path/to/infra/komodo/stacks/apps/compose.yml down
   docker compose -p reputo-observability -f /path/to/infra/komodo/stacks/observability/compose.yml down
   docker compose -p reputo-temporal -f /path/to/infra/komodo/stacks/temporal/compose.yml down
   docker compose -p reputo-database -f /path/to/infra/komodo/stacks/database/compose.yml down
   ```
2. **Check out the pre-cutover branch / tag** that still has `komodo/resources/` and `docker/compose/compose.yml`:
   ```bash
   git fetch
   git checkout <pre-cutover-tag-or-ref>
   ```
3. **Restart the old stacks**, which still see the original `reputo_*` volumes:
   ```bash
   docker compose -p reputo -f docker/compose/compose.yml --profile infra --profile observability up -d
   docker compose -p reputo -f docker/compose/compose.yml --profile apps up -d
   ```
4. **Repoint the Komodo `reputo-main` ResourceSync** back to `komodo/resources` in the UI (`Resources > Resource Syncs > reputo-main > Config`).
5. **Re-create the legacy `reputo-apps-{env}` and `reputo-infra-{env}` stacks** by syncing the old tree.

## B. Revert the migration commit

If the migration commit on `main` is the problem:

1. `git revert <migration-commit-sha>` and merge through the normal PR flow. This restores `komodo/`, `docker/compose/compose.yml`, and the old `komodo/resources/` tree.
2. In Komodo UI, update `reputo-main`'s `Resource Path` back to `komodo/resources`.
3. Run the sync, accept the diff (old stacks come back, new stacks disappear), and execute.
4. On each Periphery host:
   ```bash
   docker compose -p reputo-apps         -f infra/komodo/compose/apps.yml down
   docker compose -p reputo-observability -f infra/komodo/compose/observability.yml down
   docker compose -p reputo-temporal      -f infra/komodo/compose/temporal.yml down
   docker compose -p reputo-database      -f infra/komodo/compose/database.yml down
   ```
   The four `reputo-<stack>_*` volumes are now orphans; leave them in place until you are confident rollback is the final state, then `docker volume rm` them.
5. Trigger the original Komodo `reputo-apps-{env}` and `reputo-infra-{env}` Stacks. They reuse the original `reputo_*` volumes.

## C. Restore from pre-cutover backups

Run only if old volumes were deleted and the new stack data has been corrupted or lost.

1. Bring the new database stack up:
   ```bash
   docker compose -p reputo-database -f infra/komodo/stacks/database/compose.yml up -d postgres onchain-data-postgresql
   ```
2. Restore the API DB:
   ```bash
   gunzip -c /path/to/api-<timestamp>.sql.gz | docker exec -i postgres psql -U "$API_POSTGRES_USER" -d "$API_POSTGRES_DB_NAME"
   ```
3. Restore the onchain DB:
   ```bash
   gunzip -c /path/to/onchain-<timestamp>.sql.gz | docker exec -i onchain-data-postgresql psql -U "$ONCHAIN_DATA_POSTGRES_USER" -d "$ONCHAIN_DATA_POSTGRES_DB_NAME"
   ```
4. Grafana / Loki / Prometheus history: replay the corresponding `.tgz` into `reputo-observability_grafana_data` etc.:
   ```bash
   docker volume create reputo-observability_grafana_data
   docker run --rm -v reputo-observability_grafana_data:/dst -v /path/to/backups:/src alpine \
       sh -c 'cd /dst && tar xzf /src/grafana-<timestamp>.tgz'
   ```
5. `deploy-observability-{env}` and `deploy-apps-{env}` to rebuild on top of the restored data.

## What survives a Komodo Core failure

The `infra/komodo/` tree is plain TOML + YAML on `main`. As long as Git is intact, you can reconstruct Komodo Core from scratch by following [docs/komodo.md](../../docs/komodo.md#install-core) and re-running the sync from this directory. Periphery hosts continue to run their last-deployed containers if Core is offline.

## Useful commands during rollback

```bash
# Live volume inventory on a Periphery host
docker volume ls --filter name=reputo

# Compare new vs. old volume names
docker volume ls --format '{{.Name}}' | sort

# Watch logs while bringing a stack back up
docker compose -p reputo-database -f infra/komodo/stacks/database/compose.yml logs -f
```
