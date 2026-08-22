# ntfy-coolify-webhook-bridge

A lightweight Node.js backend that receives [Coolify](https://coolify.io) webhook events, structures the JSON payload, and forwards human-readable notifications to an [ntfy](https://ntfy.sh) server.

Each notification names the thing the event is about — which server went down, which application was deployed — and is tappable straight through to the relevant page:

```
🚨  hetzner-fsn1 · Server unreachable          ✅  api · Deployment successful
    Server: hetzner-fsn1                           Application: api
    Open in Coolify: https://…/server/a1b2         Project: atlas → production
                                                   Open application: https://api.atlas.dev
                                                   Deployment logs: https://…/deployment/d9f2
```

- **Failures** are sent with **high** priority; successes and advisories with **default**.
- Tapping the notification opens the most useful link for that event; any secondary link becomes a button.

## Quick Start

### Environment Variables

| Variable         | Description                                        | Default              |
|----------------- |----------------------------------------------------|----------------------|
| `NTFY_URL`       | Base URL of your ntfy server                       | `https://ntfy.sh`    |
| `NTFY_TOPIC`     | ntfy topic to publish notifications                | `coolify`            |
| `NTFY_TOKEN`     | ntfy access token for authentication               | *(empty — no auth)*  |
| `PORT`           | Port the server listens on                         | `3000`               |
| `WEBHOOK_SECRET` | Secret key required as `?key=` query parameter     | *(empty — no check)* |
| `LOG_LEVEL`      | `debug`, `info`, `warn`, `error` or `silent`        | `info`               |

Copy `.env.example` to `.env` and adjust the values:

```bash
cp .env.example .env
```

### Run Locally

```bash
npm install
npm start
```

### Run with Docker

```bash
docker build -t ntfy-coolify-webhook-bridge .
docker run -d -p 3000:3000 \
  -e NTFY_URL=https://ntfy.example.com \
  -e NTFY_TOPIC=coolify \
  -e NTFY_TOKEN=your-ntfy-access-token \
  -e WEBHOOK_SECRET=your-secret-key \
  ntfy-coolify-webhook-bridge
```

### Deploy on Coolify

1. Create a new service in Coolify and point it to this repository.
2. Set the build pack to **Dockerfile**.
3. Add the environment variables `NTFY_URL`, `NTFY_TOPIC`, `NTFY_TOKEN`, and optionally `WEBHOOK_SECRET`.
4. Deploy.

## API

### `GET /health`

Health check endpoint. Returns `{ "status": "ok" }`.

### `POST /webhook`

Receives a Coolify webhook JSON payload and forwards a notification to ntfy.

When `WEBHOOK_SECRET` is set, the request must include a matching `key` query parameter (e.g. `POST /webhook?key=your-secret-key`). Requests with a missing or incorrect key receive a `401 Unauthorized` response.

**Example request** (a real Coolify `deployment_success` payload):

```bash
curl -X POST "http://localhost:3000/webhook?key=your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "success": true,
    "message": "New version successfully deployed",
    "event": "deployment_success",
    "application_name": "api",
    "deployment_url": "https://coolify.example.com/project/p/environment/e/application/a/deployment/d9f2",
    "project": "atlas",
    "environment": "production",
    "fqdn": "https://api.atlas.dev"
  }'
```

**Success response:**

```json
{
  "message": "Notification sent",
  "priority": "default",
  "title": "api · Deployment successful"
}
```

## Supported Events

Every Coolify webhook event is recognised and formatted with the fields it actually carries. The subject column is what appears first in the notification title.

| Event | Subject | Priority | Also shown |
|---|---|---|---|
| `deployment_success` / `deployment_failed` | application name | default / **high** | project → environment, PR number, live URL, deployment logs |
| `status_changed` | application name | **high** | project → environment, links |
| `restart_limit_reached` | application name | **high** | restart count / limit |
| `server_reachable` / `server_unreachable` | **server name** | default / **high** | link to the server |
| `high_disk_usage` | server name | **high** | usage % and threshold |
| `docker_cleanup_success` / `_failed` | server name | default / **high** | cleanup result or error |
| `server_patch_check` / `_error` | server name | default | update count, critical packages, package manager |
| `traefik_version_outdated` | server name, or affected count | default | current → latest version per server |
| `container_stopped` / `_restarted` | container name | **high** / default | the server it ran on |
| `backup_success` / `_failed` / `_with_s3_warning` | database name | default / **high** / default | database type, schedule, error output |
| `task_success` / `task_failed` | task name | default / **high** | command output |
| `test` | — | default | link to Coolify |

Advisory events (`server_patch_check`, `traefik_version_outdated`, `backup_success_with_s3_warning`) report `success: false` but stay at **default** priority so they don't buzz like an outage.

Long command output (`error_output`, `output`, cleanup messages) is truncated, and the body is capped below ntfy's 4096-byte limit so notifications are never converted into attachments.

### Unrecognised payloads

Anything the bridge doesn't recognise — a future Coolify event, or a hand-rolled payload — still renders. It falls back to generic fields (`message`, `type`, `status`, `project`, `environment`, `data.commit` / `data.branch` / `data.url`, `timestamp`) and derives priority from `success`, or from error keywords (`error`, `fail`, `failed`, `failure`, `crashed`, `timeout`, `cancelled`) in `status` / `type` / `event`.

## Logging

Every webhook the bridge receives and every notification it sends is logged as
a single line — a timestamp, the level, a short message, then the fields as
`key=value` pairs:

```
2026-08-22T09:14:02.118Z INFO Received webhook event=deployment_success recognised=true subject=api success=true
2026-08-22T09:14:02.244Z INFO Sent notification event=deployment_success recognised=true subject=api success=true topic=coolify title="api · Deployment successful" priority=default tags=white_check_mark links=2 bytes=184 status=200 ms=124
```

`recognised` says whether the event is in the catalog above, so an unknown
Coolify event shows up in the logs rather than silently rendering generically.

Rejected and failed requests are written to stderr:

```
2026-08-22T09:15:41.002Z WARN Rejected webhook reason="invalid or missing key" ip=203.0.113.9
2026-08-22T09:16:07.551Z WARN Rejected webhook reason="empty payload" ip=203.0.113.9
2026-08-22T09:17:22.870Z ERROR ntfy rejected notification … status=503 ms=88
2026-08-22T09:18:03.412Z ERROR Failed to reach ntfy event=deployment_failed … details="fetch failed"
```

Set `LOG_LEVEL=debug` to additionally log the full JSON payload of each
webhook (`Received payload body="{…}"`), or `LOG_LEVEL=silent` to turn logging
off. Tokens and the webhook secret are never logged.

## Tests

```bash
npm test
```