# Observability

Reputo ships a full observability stack: metrics, logs, and dashboards. It runs as the
`reputo-observability-{env}` Komodo stack, one per environment, defined in
[`infra/komodo/stacks/observability/`](../infra/komodo/stacks/observability/). This page
explains what is in the stack and how to use it.

## What is in the stack

| Service | Role |
| --- | --- |
| **Grafana** | Dashboards and log/metric exploration. The only service exposed to the web. |
| **Prometheus** | Stores metrics. Scrapes every 15s. Retains 15 days. |
| **Loki** | Stores logs. Retains 7 days. |
| **Promtail** | Ships container logs into Loki. |
| **cAdvisor** | Per-container CPU, memory, and network metrics. |
| **node-exporter** | Host CPU, memory, and disk metrics. |

Promtail collects logs from every container on the host except the observability services
themselves, and labels them with `service`, `container`, `compose_project`,
`compose_service`, and `env`.

## Open Grafana

1. Go to the Grafana host for the environment — the `GRAFANA_DOMAIN` value (the staging or
   production Grafana URL). It is served over HTTPS through Traefik.
2. Traefik asks for **basic auth** first (the `GRAFANA_AUTH` credentials).
3. Then sign in to **Grafana** itself with the admin user and password
   (`GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`).

Self sign-up and anonymous access are off. Credentials live in Komodo Variables — see
[Komodo operations](komodo.md).

## Dashboards

Three dashboards are provisioned automatically (under **Dashboards** in Grafana):

- **Service Overview** — the best starting point. Log volume and error rate per service,
  Traefik 5xx rate, request latency (p50 / p95 / p99), slow requests (> 1s), top errors,
  and requests by path.
- **Service Logs** — log volume, error / warning counts, log-level distribution, and a
  live log panel. Use this to read what a service is doing.
- **Container Metrics** — host CPU / memory / disk, plus CPU, memory, and network per
  container, and container status.

The dashboards are read-only in the UI because they are provisioned from JSON. To change
one, edit the matching file in
[`config/grafana/provisioning/dashboards/`](../infra/komodo/stacks/observability/config/grafana/provisioning/dashboards/)
and redeploy the stack.

## Explore logs

Open **Explore**, pick the **Loki** data source, and filter by label. For example:

- `{service="api"}` — all API logs.
- `{service="api"} |= "error"` — API logs containing "error".
- `{compose_project="reputo-apps"}` — every app container.

## Explore metrics

Open **Explore** and pick the **Prometheus** data source. Metrics come from cAdvisor
(containers) and node-exporter (host). Prometheus scrapes itself, cAdvisor, and
node-exporter every 15 seconds.

## Temporal workflows

Workflow runs, including snapshots, are visible in the Temporal Web UI for the environment
(`TEMPORAL_UI_DOMAIN`), which is separate from Grafana. Use it to inspect a stuck or failed
snapshot workflow.

## Retention

- Metrics: **15 days** (Prometheus).
- Logs: **7 days** (Loki).

Raise these in the stack config if you need a longer history; both cost disk.
