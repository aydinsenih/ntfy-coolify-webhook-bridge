const NTFY_URL = process.env.NTFY_URL || "https://ntfy.sh";
const NTFY_TOPIC = process.env.NTFY_TOPIC || "coolify";
const NTFY_TOKEN = process.env.NTFY_TOKEN || "";

/**
 * Determine ntfy priority based on the webhook payload.
 * Returns "high" when any error-like status is detected, "default" otherwise.
 */
function getPriority(payload) {
  const status = (payload.status || "").toLowerCase();
  const type = (payload.type || "").toLowerCase();
  const event = (payload.event || "").toLowerCase();

  const errorKeywords = ["error", "fail", "failed", "failure", "crashed", "timeout", "cancelled"];

  for (const keyword of errorKeywords) {
    if (status.includes(keyword) || type.includes(keyword) || event.includes(keyword)) {
      return "high";
    }
  }

  return "default";
}

/**
 * Build a human-readable notification title from the webhook payload.
 */
function buildTitle(payload) {
  const parts = [];
  if (payload.project || payload.project_name) {
    parts.push(payload.project || payload.project_name);
  }
  if (payload.event) {
    parts.push(payload.event);
  }
  if (payload.type) {
    parts.push(payload.type);
  }
  if (payload.status) {
    parts.push(payload.status);
  }

  return parts.length > 0 ? `Coolify: ${parts.join(" | ")}` : "Coolify Webhook";
}

/**
 * Build a human-readable notification body from the webhook payload.
 */
function buildBody(payload) {
  const lines = [];

  if (payload.event) lines.push(`Event: ${payload.event}`);
  if (payload.type) lines.push(`Type: ${payload.type}`);
  if (payload.status) lines.push(`Status: ${payload.status}`);
  if (payload.project || payload.project_name) {
    lines.push(`Project: ${payload.project || payload.project_name}`);
  }
  if (payload.environment) lines.push(`Environment: ${payload.environment}`);
  if (payload.message) lines.push(`Message: ${payload.message}`);

  if (payload.data && typeof payload.data === "object") {
    if (payload.data.commit) lines.push(`Commit: ${payload.data.commit}`);
    if (payload.data.branch) lines.push(`Branch: ${payload.data.branch}`);
    if (payload.data.url) lines.push(`URL: ${payload.data.url}`);
  }

  if (payload.timestamp) lines.push(`Time: ${payload.timestamp}`);

  return lines.length > 0 ? lines.join("\n") : JSON.stringify(payload, null, 2);
}

/**
 * Build the tags for the ntfy notification.
 */
function buildTags(payload) {
  const priority = getPriority(payload);
  return priority === "high" ? "rotating_light" : "white_check_mark";
}

/**
 * Send a notification to the ntfy server.
 * @param {object} payload - The Coolify webhook payload
 * @returns {Promise<{ok: boolean, status: number}>}
 */
async function sendNotification(payload) {
  const url = `${NTFY_URL.replace(/\/+$/, "")}/${encodeURIComponent(NTFY_TOPIC)}`;
  const priority = getPriority(payload);
  const title = buildTitle(payload);
  const body = buildBody(payload);
  const tags = buildTags(payload);

  const headers = {
    "Title": title,
    "Priority": priority,
    "Tags": tags,
    "Content-Type": "text/plain",
  };

  if (NTFY_TOKEN) {
    headers["Authorization"] = `Bearer ${NTFY_TOKEN}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: body,
  });

  return { ok: response.ok, status: response.status };
}

module.exports = { getPriority, buildTitle, buildBody, buildTags, sendNotification };
