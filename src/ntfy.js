const logger = require("./logger");

const NTFY_URL = process.env.NTFY_URL || "https://ntfy.sh";
const NTFY_TOPIC = process.env.NTFY_TOPIC || "coolify";
const NTFY_TOKEN = process.env.NTFY_TOKEN || "";

// ntfy converts messages larger than 4096 bytes into attachments, so keep the
// body below that and clip the free-form command output some events embed.
const MAX_BODY_CHARS = 3800;
const MAX_OUTPUT_CHARS = 600;

// ntfy allows at most three action buttons per notification, and the first link
// is spent on the click action.
const MAX_ACTIONS = 3;

// Separates the subject from the event label in the title. Non-ASCII, so titles
// travel RFC 2047-encoded; ntfy decodes them server-side.
const TITLE_SEPARATOR = " · ";

const ERROR_KEYWORDS = ["error", "fail", "failed", "failure", "crashed", "timeout", "cancelled"];

/**
 * Convert a snake_case or dot.separated string to Title Case.
 */
function toTitleCase(str) {
  return str
    .replace(/[._-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(value, max) {
  const text = String(value).trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Coolify stores an fqdn with its scheme, but it may hold a comma-separated
 * list. Take the first entry and make sure it is something a client can open.
 */
function normalizeUrl(value) {
  if (!value) return null;
  const url = String(value).split(",")[0].trim();
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function resolve(value, payload) {
  return typeof value === "function" ? value(payload) : value;
}

/* -------------------------------------------------------------------------
 * Shared detail builders
 * ---------------------------------------------------------------------- */

function applicationDetails(payload) {
  const scope = [payload.project, payload.environment].filter(Boolean).join(" → ");
  return [
    payload.application_name && `Application: ${payload.application_name}`,
    scope && `Project: ${scope}`,
    payload.pull_request_id && `Pull request: #${payload.pull_request_id}`,
  ];
}

function serverDetails(payload) {
  return [payload.server_name && `Server: ${payload.server_name}`];
}

function databaseDetails(payload) {
  return [
    payload.database_name &&
      `Database: ${payload.database_name}${payload.database_type ? ` (${payload.database_type})` : ""}`,
    payload.frequency && `Schedule: ${payload.frequency}`,
  ];
}

function outputLine(label, value) {
  return value ? `${label}: ${truncate(value, MAX_OUTPUT_CHARS)}` : null;
}

const coolifyLink = (payload) => [{ label: "Open in Coolify", url: payload.url }];

/* -------------------------------------------------------------------------
 * Event catalog
 *
 * Every Coolify webhook carries `event`, `success` and `message` plus fields
 * specific to that event. This table maps each event to the name it is about
 * (the subject), a human label, and the fields worth surfacing. Verified
 * against the `toWebhook()` methods in coollabsio/coolify app/Notifications.
 * ---------------------------------------------------------------------- */

const applicationName = (payload) => payload.application_name;
const serverName = (payload) => payload.server_name;

const EVENTS = {
  // ---- Applications -----------------------------------------------------
  deployment_success: {
    label: (p) => (p.pull_request_id ? "Preview deployment successful" : "Deployment successful"),
    subject: applicationName,
    priority: "default",
    tags: "white_check_mark",
    details: applicationDetails,
    links: (p) => [
      { label: "Open application", url: p.preview_fqdn || p.fqdn },
      { label: "Deployment logs", url: p.deployment_url },
    ],
  },
  deployment_failed: {
    label: (p) => (p.pull_request_id ? "Preview deployment failed" : "Deployment failed"),
    subject: applicationName,
    priority: "high",
    tags: "rotating_light",
    details: applicationDetails,
    links: (p) => [
      { label: "Deployment logs", url: p.deployment_url },
      { label: "Open application", url: p.preview_fqdn || p.fqdn },
    ],
  },
  status_changed: {
    label: "Application stopped",
    subject: applicationName,
    priority: "high",
    tags: "octagonal_sign",
    details: applicationDetails,
    links: (p) => [
      { label: "Open in Coolify", url: p.url },
      { label: "Open application", url: p.fqdn },
    ],
  },
  restart_limit_reached: {
    label: "Restart limit reached",
    subject: applicationName,
    priority: "high",
    tags: "rotating_light",
    details: (p) => [
      ...applicationDetails(p),
      p.restart_count != null &&
        `Restarts: ${p.restart_count}${p.max_restart_count != null ? ` / ${p.max_restart_count}` : ""}`,
    ],
    links: (p) => [
      { label: "Open in Coolify", url: p.url },
      { label: "Open application", url: p.fqdn },
    ],
  },

  // ---- Servers ----------------------------------------------------------
  server_reachable: {
    label: "Server reachable again",
    subject: serverName,
    priority: "default",
    tags: "white_check_mark",
    details: serverDetails,
    links: coolifyLink,
  },
  server_unreachable: {
    label: "Server unreachable",
    subject: serverName,
    priority: "high",
    tags: "rotating_light",
    details: serverDetails,
    links: coolifyLink,
  },
  high_disk_usage: {
    label: (p) => (p.disk_usage != null ? `Disk usage at ${p.disk_usage}%` : "High disk usage"),
    subject: serverName,
    priority: "high",
    tags: "floppy_disk",
    details: (p) => [
      ...serverDetails(p),
      p.disk_usage != null &&
        `Disk usage: ${p.disk_usage}%${p.threshold != null ? ` (threshold ${p.threshold}%)` : ""}`,
    ],
    links: coolifyLink,
  },
  docker_cleanup_success: {
    label: "Docker cleanup finished",
    subject: serverName,
    priority: "default",
    tags: "whale",
    details: (p) => [...serverDetails(p), outputLine("Result", p.cleanup_message)],
    links: coolifyLink,
  },
  docker_cleanup_failed: {
    label: "Docker cleanup failed",
    subject: serverName,
    priority: "high",
    tags: "rotating_light",
    details: (p) => [...serverDetails(p), outputLine("Error", p.error_message)],
    links: coolifyLink,
  },
  server_patch_check: {
    label: (p) =>
      p.total_updates != null
        ? `${p.total_updates} update${p.total_updates === 1 ? "" : "s"} available`
        : "Updates available",
    subject: serverName,
    priority: "default",
    tags: "package",
    details: (p) => [
      ...serverDetails(p),
      p.total_updates != null &&
        `Updates: ${p.total_updates}${p.critical_packages_count ? ` (${p.critical_packages_count} critical)` : ""}`,
      p.package_manager && `Package manager: ${p.package_manager}${p.os_id ? ` (${p.os_id})` : ""}`,
    ],
    links: coolifyLink,
  },
  server_patch_check_error: {
    label: "Patch check failed",
    subject: serverName,
    priority: "default",
    tags: "warning",
    details: (p) => [
      ...serverDetails(p),
      outputLine("Error", p.error),
      p.package_manager && `Package manager: ${p.package_manager}${p.os_id ? ` (${p.os_id})` : ""}`,
    ],
    links: coolifyLink,
  },
  traefik_version_outdated: {
    label: "Traefik proxy outdated",
    subject: (p) => {
      const servers = Array.isArray(p.servers) ? p.servers : [];
      if (servers.length === 1) return servers[0].name;
      const count = p.affected_servers_count != null ? p.affected_servers_count : servers.length;
      return count ? `${count} servers` : null;
    },
    priority: "default",
    tags: "warning",
    details: (p) =>
      (Array.isArray(p.servers) ? p.servers : []).map(
        (s) => `${s.name}: ${s.current_version} → ${s.latest_version}${s.upgrade_target ? ` (${s.upgrade_target})` : ""}`
      ),
    links: () => [],
  },

  // ---- Containers -------------------------------------------------------
  container_stopped: {
    label: "Container stopped unexpectedly",
    subject: (p) => p.container_name,
    priority: "high",
    tags: "octagonal_sign",
    details: (p) => [p.container_name && `Container: ${p.container_name}`, ...serverDetails(p)],
    links: coolifyLink,
  },
  container_restarted: {
    label: "Container restarted automatically",
    subject: (p) => p.container_name,
    priority: "default",
    tags: "arrows_counterclockwise",
    details: (p) => [p.container_name && `Container: ${p.container_name}`, ...serverDetails(p)],
    links: coolifyLink,
  },

  // ---- Database backups -------------------------------------------------
  backup_success: {
    label: "Backup successful",
    subject: (p) => p.database_name,
    priority: "default",
    tags: "floppy_disk",
    details: databaseDetails,
    links: coolifyLink,
  },
  backup_failed: {
    label: "Backup failed",
    subject: (p) => p.database_name,
    priority: "high",
    tags: "rotating_light",
    details: (p) => [...databaseDetails(p), outputLine("Error", p.error_output)],
    links: coolifyLink,
  },
  backup_success_with_s3_warning: {
    label: "Backup succeeded, S3 upload failed",
    subject: (p) => p.database_name,
    priority: "default",
    tags: "warning",
    details: (p) => [...databaseDetails(p), outputLine("S3 error", p.s3_error)],
    links: (p) => [
      { label: "Open in Coolify", url: p.url },
      { label: "S3 storage", url: p.s3_storage_url },
    ],
  },

  // ---- Scheduled tasks --------------------------------------------------
  task_success: {
    label: "Scheduled task succeeded",
    subject: (p) => p.task_name,
    priority: "default",
    tags: "white_check_mark",
    details: (p) => [p.task_name && `Task: ${p.task_name}`, outputLine("Output", p.output)],
    links: coolifyLink,
  },
  task_failed: {
    label: "Scheduled task failed",
    subject: (p) => p.task_name,
    priority: "high",
    tags: "rotating_light",
    details: (p) => [p.task_name && `Task: ${p.task_name}`, outputLine("Output", p.output)],
    links: coolifyLink,
  },

  // ---- Misc -------------------------------------------------------------
  test: {
    label: "Test notification",
    subject: () => null,
    priority: "default",
    tags: "wave",
    details: (p) => [p.message],
    links: (p) => [{ label: "Open Coolify", url: p.url }],
  },
};

/**
 * Look up the catalog entry for a payload, if this is a known Coolify event.
 */
function getEvent(payload) {
  const event = typeof payload.event === "string" ? payload.event : "";
  return EVENTS[event.toLowerCase()] || null;
}

/**
 * Best-effort subject for payloads outside the catalog: an unknown Coolify
 * event, or a hand-rolled payload posted straight at the bridge.
 */
function fallbackSubject(payload) {
  return (
    payload.application_name ||
    payload.server_name ||
    payload.container_name ||
    payload.database_name ||
    payload.task_name ||
    payload.project ||
    payload.project_name ||
    null
  );
}

/**
 * The identifying fields of a payload, for a log line: what happened, what it
 * happened to, and whether the catalog recognised the event.
 */
function describePayload(payload) {
  const event = getEvent(payload);

  return {
    event: payload.event || payload.type || payload.status || "unknown",
    recognised: Boolean(event),
    subject: (event ? resolve(event.subject, payload) : null) || fallbackSubject(payload),
    success: payload.success,
  };
}

/**
 * Determine ntfy priority. Known events carry a curated priority so advisory
 * events (available patches, an outdated proxy) do not buzz like an outage.
 * Anything else falls back to keyword matching on the legacy fields.
 */
function getPriority(payload) {
  const event = getEvent(payload);
  if (event) return event.priority;

  if (payload.success === false) return "high";

  const haystack = [payload.status, payload.type, payload.event]
    .map((v) => (v || "").toLowerCase())
    .join(" ");

  return ERROR_KEYWORDS.some((keyword) => haystack.includes(keyword)) ? "high" : "default";
}

/**
 * Build a human-readable notification title: the thing the event is about,
 * followed by what happened to it.
 */
function buildTitle(payload) {
  const event = getEvent(payload);

  if (event) {
    const subject = resolve(event.subject, payload);
    const label = resolve(event.label, payload);
    return [subject || "Coolify", label].join(TITLE_SEPARATOR);
  }

  const subject = fallbackSubject(payload);
  const label = payload.event
    ? toTitleCase(payload.event)
    : [payload.type, payload.status].filter(Boolean).map(toTitleCase).join(" ") || payload.message;

  if (subject && label) return [toTitleCase(subject), label].join(TITLE_SEPARATOR);
  if (subject) return ["Coolify", toTitleCase(subject)].join(TITLE_SEPARATOR);
  if (label) return ["Coolify", label].join(TITLE_SEPARATOR);
  return "Coolify Webhook";
}

/**
 * Collect the links a payload offers, most useful first. The first becomes the
 * notification's click action; the rest become buttons.
 */
function buildLinks(payload) {
  const event = getEvent(payload);
  const candidates = event ? resolve(event.links, payload) : coolifyLink(payload);

  const seen = new Set();
  return (candidates || [])
    .map((link) => ({ label: link.label, url: normalizeUrl(link.url) }))
    .filter((link) => {
      if (!link.url || seen.has(link.url)) return false;
      seen.add(link.url);
      return true;
    })
    .slice(0, MAX_ACTIONS + 1);
}

/**
 * Build the notification body: the details this specific event carries,
 * followed by its links. The raw `event` name is deliberately omitted — it is
 * already spelled out in the title.
 */
function buildBody(payload) {
  const event = getEvent(payload);
  const details = event ? resolve(event.details, payload) : legacyDetails(payload);
  const links = buildLinks(payload);

  const lines = [
    ...(details || []).filter(Boolean),
    ...links.map((link) => `${link.label}: ${link.url}`),
  ];

  if (lines.length === 0) {
    return payload.message ? String(payload.message) : JSON.stringify(payload, null, 2);
  }

  return truncate(lines.join("\n"), MAX_BODY_CHARS);
}

/**
 * Detail lines for payloads outside the catalog, using the generic fields a
 * non-Coolify sender is likely to provide.
 */
function legacyDetails(payload) {
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};

  return [
    payload.message,
    payload.type && `Type: ${payload.type}`,
    payload.status && `Status: ${payload.status}`,
    (payload.project || payload.project_name) && `Project: ${payload.project || payload.project_name}`,
    payload.environment && `Environment: ${payload.environment}`,
    data.commit && `Commit: ${data.commit}`,
    data.branch && `Branch: ${data.branch}`,
    data.url && `URL: ${data.url}`,
    payload.timestamp && `Time: ${payload.timestamp}`,
  ];
}

/**
 * Build the tags for the ntfy notification. Tags render as the notification's
 * emoji, so each event gets one that matches what it is.
 */
function buildTags(payload) {
  const event = getEvent(payload);
  if (event) return event.tags;

  return getPriority(payload) === "high" ? "rotating_light" : "white_check_mark";
}

/**
 * HTTP header values are limited to ASCII, so RFC 2047-encode anything else.
 * ntfy decodes this server-side, so clients still receive proper UTF-8.
 */
function encodeHeader(value) {
  const text = String(value).replace(/[\r\n]+/g, " ").trim();
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

/**
 * Render the ntfy Actions header for every link after the click action.
 */
function buildActionsHeader(links) {
  return links
    .slice(1)
    .map((link) => `view, '${link.label.replace(/['",;]/g, "")}', '${link.url}'`)
    .join("; ");
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
  const links = buildLinks(payload);

  const headers = {
    "Title": encodeHeader(title),
    "Priority": priority,
    "Tags": tags,
    "Content-Type": "text/plain; charset=utf-8",
  };

  if (links.length > 0) {
    headers["Click"] = links[0].url;

    const actions = buildActionsHeader(links);
    if (actions) headers["Actions"] = actions;
  }

  if (NTFY_TOKEN) {
    headers["Authorization"] = `Bearer ${NTFY_TOKEN}`;
  }

  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: body,
  });

  const outcome = {
    ...describePayload(payload),
    topic: NTFY_TOPIC,
    title,
    priority,
    tags,
    links: links.length,
    bytes: Buffer.byteLength(body, "utf8"),
    status: response.status,
    ms: Date.now() - startedAt,
  };

  if (response.ok) {
    logger.info("Sent notification", outcome);
  } else {
    logger.error("ntfy rejected notification", outcome);
  }

  return { ok: response.ok, status: response.status };
}

module.exports = {
  describePayload,
  getPriority,
  buildTitle,
  buildBody,
  buildTags,
  buildLinks,
  sendNotification,
  toTitleCase,
};
