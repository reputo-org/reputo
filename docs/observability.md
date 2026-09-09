# Observability

Metrics, logs, and dashboards for staging and production. Each environment runs the `reputo-observability-{env}` Komodo stack, defined in [`infra/komodo/stacks/observability/`](../infra/komodo/stacks/observability/).

## What is in the stack

| Service | Role |
| --- | --- |
| Grafana | Dashboards and log or metric exploration. The only service exposed to the web. |
| Prometheus | Stores metrics. Scrapes every 15 seconds. Keeps 15 days. |
| Loki | Stores logs. Keeps 7 days. |
| Promtail | Ships container logs into Loki. |
| cAdvisor | Per-container CPU, memory, and network metrics. |
| node-exporter | Host CPU, memory, and disk metrics. |

Promtail collects logs from every container on the host except the observability services. It labels them with `service`, `container`, `compose_project`, `compose_service`, and `env`.

## Open Grafana

1. Open the Grafana URL of the environment (`GRAFANA_DOMAIN`).
2. Enter the Traefik basic-auth credentials (`GRAFANA_AUTH`).
3. Sign in to Grafana with `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD`.

Self sign-up and anonymous access are off. The values are Komodo variables. See [Komodo operations](komodo.md).

## Dashboards

| Dashboard | Use it for |
| --- | --- |
| Service Overview | The starting point: log volume and error rate per service, Traefik 5xx rate, latency (p50 / p95 / p99), slow requests, top errors. |
| Service Logs | Log volume, error and warning counts, and a live log panel. |
| Container Metrics | Host CPU, memory, and disk, plus per-container CPU, memory, and network. |

Dashboards are provisioned from JSON and read-only in the UI. To change one, edit its file under [`config/grafana/provisioning/dashboards/`](../infra/komodo/stacks/observability/config/grafana/provisioning/dashboards/) and redeploy the stack.

## Explore logs and metrics

Open **Explore** and pick a data source:

- Loki: `{service="api"}` for all API logs, `{service="api"} |= "error"` to filter, `{compose_project="reputo-apps"}` for every app container.
- Prometheus: metrics from cAdvisor and node-exporter.

## Temporal

Workflow runs, including snapshots, are visible in the Temporal Web UI of the environment (`TEMPORAL_UI_DOMAIN`). Use it to inspect a stuck or failed snapshot.

## Retention

Metrics are kept 15 days, logs 7 days. Raise them in the stack config if needed. Both cost disk.
