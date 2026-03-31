# ntfy-coolify-webhook-bridge

A lightweight Node.js backend that receives [Coolify](https://coolify.io) webhook events, structures the JSON payload, and forwards human-readable notifications to an [ntfy](https://ntfy.sh) server.

- **Success** events are sent with **default** priority.
- **Error / failure** events are sent with **high** priority.

## Quick Start

### Environment Variables

| Variable         | Description                                        | Default              |
|----------------- |----------------------------------------------------|----------------------|
| `NTFY_URL`       | Base URL of your ntfy server                       | `https://ntfy.sh`    |
| `NTFY_TOPIC`     | ntfy topic to publish notifications                | `coolify`            |
| `NTFY_TOKEN`     | ntfy access token for authentication               | *(empty — no auth)*  |
| `PORT`           | Port the server listens on                         | `3000`               |
| `WEBHOOK_SECRET` | Secret key required as `?key=` query parameter     | *(empty — no check)* |

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

**Example request:**

```bash
curl -X POST "http://localhost:3000/webhook?key=your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "deployment.completed",
    "status": "success",
    "project": "my-app",
    "environment": "production",
    "timestamp": "2026-03-28T07:00:00Z"
  }'
```

**Success response:**

```json
{
  "message": "Notification sent",
  "priority": "default",
  "title": "Coolify: my-app | deployment.completed | success"
}
```

## Priority Logic

The bridge inspects the `status`, `type`, and `event` fields of the incoming payload. If any of these fields contain error-related keywords (`error`, `fail`, `failed`, `failure`, `crashed`, `timeout`, `cancelled`), the notification is sent with **high** priority. Otherwise, **default** priority is used.

## Tests

```bash
npm test
```