const {
  describePayload,
  getPriority,
  buildTitle,
  buildBody,
  buildTags,
  buildLinks,
  sendNotification,
  toTitleCase,
} = require("../src/ntfy");

/**
 * Fixtures mirror the payloads Coolify actually sends, taken from the
 * `toWebhook()` methods in coollabsio/coolify app/Notifications.
 */
const deploymentSuccess = {
  success: true,
  message: "New version successfully deployed",
  event: "deployment_success",
  application_name: "api",
  application_uuid: "app-uuid",
  deployment_uuid: "deploy-uuid",
  deployment_url: "https://coolify.example.com/project/p/environment/e/application/a/deployment/deploy-uuid",
  project: "atlas",
  environment: "production",
  fqdn: "https://api.atlas.dev",
};

const deploymentFailed = {
  ...deploymentSuccess,
  success: false,
  message: "Deployment failed",
  event: "deployment_failed",
};

const serverUnreachable = {
  success: false,
  message: "Server unreachable",
  event: "server_unreachable",
  server_name: "hetzner-fsn1",
  server_uuid: "server-uuid",
  url: "https://coolify.example.com/server/server-uuid",
};

const serverReachable = {
  ...serverUnreachable,
  success: true,
  message: "Server revived",
  event: "server_reachable",
};

describe("toTitleCase", () => {
  test("converts snake_case to Title Case", () => {
    expect(toTitleCase("traefik_version_outdated")).toBe("Traefik Version Outdated");
  });

  test("converts dot.separated to Title Case", () => {
    expect(toTitleCase("deployment.completed")).toBe("Deployment Completed");
  });

  test("capitalizes single word", () => {
    expect(toTitleCase("success")).toBe("Success");
  });

  test("converts hyphenated to Title Case", () => {
    expect(toTitleCase("my-app")).toBe("My App");
  });
});

describe("buildTitle", () => {
  test("names the application for deployment events", () => {
    expect(buildTitle(deploymentSuccess)).toBe("api · Deployment successful");
    expect(buildTitle(deploymentFailed)).toBe("api · Deployment failed");
  });

  test("names the server for server events", () => {
    expect(buildTitle(serverUnreachable)).toBe("hetzner-fsn1 · Server unreachable");
    expect(buildTitle(serverReachable)).toBe("hetzner-fsn1 · Server reachable again");
  });

  test("names the container for container events", () => {
    const title = buildTitle({
      event: "container_stopped",
      container_name: "worker-1",
      server_name: "hetzner-fsn1",
    });
    expect(title).toBe("worker-1 · Container stopped unexpectedly");
  });

  test("names the database for backup events", () => {
    const title = buildTitle({
      event: "backup_failed",
      database_name: "postgres-main",
      database_type: "postgresql",
    });
    expect(title).toBe("postgres-main · Backup failed");
  });

  test("names the task for scheduled task events", () => {
    expect(buildTitle({ event: "task_failed", task_name: "nightly-prune" }))
      .toBe("nightly-prune · Scheduled task failed");
  });

  test("marks preview deployments as such", () => {
    const title = buildTitle({ ...deploymentSuccess, pull_request_id: 42 });
    expect(title).toBe("api · Preview deployment successful");
  });

  test("includes the disk figure for high disk usage", () => {
    const title = buildTitle({
      event: "high_disk_usage",
      server_name: "hetzner-fsn1",
      disk_usage: 85,
      threshold: 80,
    });
    expect(title).toBe("hetzner-fsn1 · Disk usage at 85%");
  });

  test("includes the update count for patch checks", () => {
    expect(buildTitle({ event: "server_patch_check", server_name: "web-1", total_updates: 12 }))
      .toBe("web-1 · 12 updates available");
    expect(buildTitle({ event: "server_patch_check", server_name: "web-1", total_updates: 1 }))
      .toBe("web-1 · 1 update available");
  });

  test("names the single affected server for an outdated traefik", () => {
    const title = buildTitle({
      event: "traefik_version_outdated",
      affected_servers_count: 1,
      servers: [{ name: "web-1", current_version: "v3.1.2", latest_version: "v3.5.0" }],
    });
    expect(title).toBe("web-1 · Traefik proxy outdated");
  });

  test("counts the affected servers when more than one traefik is outdated", () => {
    const title = buildTitle({
      event: "traefik_version_outdated",
      affected_servers_count: 3,
      servers: [{ name: "web-1" }, { name: "web-2" }, { name: "web-3" }],
    });
    expect(title).toBe("3 servers · Traefik proxy outdated");
  });

  test("falls back to generic fields for unknown payloads", () => {
    const title = buildTitle({ project: "my-app", status: "success" });
    expect(title).toContain("My App");
    expect(title).toContain("Success");
  });

  test("uses project_name when project is absent", () => {
    expect(buildTitle({ project_name: "other-app" })).toContain("Other App");
  });

  test("title-cases an unknown event name", () => {
    expect(buildTitle({ event: "some_future_event" })).toBe("Coolify · Some Future Event");
  });

  test("returns default title for empty payload", () => {
    expect(buildTitle({})).toBe("Coolify Webhook");
  });
});

describe("buildBody", () => {
  test("never repeats the raw event name", () => {
    const payloads = [deploymentSuccess, deploymentFailed, serverReachable, serverUnreachable];
    for (const payload of payloads) {
      expect(buildBody(payload)).not.toContain(payload.event);
      expect(buildBody(payload)).not.toContain("Event:");
    }
  });

  test("identifies which application was deployed", () => {
    const body = buildBody(deploymentSuccess);
    expect(body).toContain("Application: api");
    expect(body).toContain("Project: atlas → production");
    expect(body).toContain("Open application: https://api.atlas.dev");
    expect(body).toContain(`Deployment logs: ${deploymentSuccess.deployment_url}`);
  });

  test("puts the logs first for a failed deployment", () => {
    const body = buildBody(deploymentFailed);
    expect(body.indexOf("Deployment logs:")).toBeLessThan(body.indexOf("Open application:"));
  });

  test("identifies which server is unreachable", () => {
    const body = buildBody(serverUnreachable);
    expect(body).toContain("Server: hetzner-fsn1");
    expect(body).toContain("Open in Coolify: https://coolify.example.com/server/server-uuid");
  });

  test("identifies which server was revived", () => {
    expect(buildBody(serverReachable)).toContain("Server: hetzner-fsn1");
  });

  test("reports the pull request for preview deployments", () => {
    const body = buildBody({ ...deploymentSuccess, pull_request_id: 42, preview_fqdn: "https://pr-42.atlas.dev" });
    expect(body).toContain("Pull request: #42");
    expect(body).toContain("Open application: https://pr-42.atlas.dev");
  });

  test("reports disk usage against its threshold", () => {
    const body = buildBody({
      event: "high_disk_usage",
      server_name: "hetzner-fsn1",
      disk_usage: 85,
      threshold: 80,
      url: "https://coolify.example.com/server/x",
    });
    expect(body).toContain("Server: hetzner-fsn1");
    expect(body).toContain("Disk usage: 85% (threshold 80%)");
  });

  test("reports the container and the server it ran on", () => {
    const body = buildBody({
      event: "container_stopped",
      container_name: "worker-1",
      server_name: "hetzner-fsn1",
      url: "https://coolify.example.com/server/x",
    });
    expect(body).toContain("Container: worker-1");
    expect(body).toContain("Server: hetzner-fsn1");
  });

  test("reports database type and schedule for backups", () => {
    const body = buildBody({
      event: "backup_success",
      database_name: "postgres-main",
      database_type: "postgresql",
      frequency: "0 0 * * *",
      url: "https://coolify.example.com/project/p/environment/e/database/d",
    });
    expect(body).toContain("Database: postgres-main (postgresql)");
    expect(body).toContain("Schedule: 0 0 * * *");
  });

  test("lists per-server versions for an outdated traefik", () => {
    const body = buildBody({
      event: "traefik_version_outdated",
      affected_servers_count: 2,
      servers: [
        { name: "web-1", current_version: "v3.1.2", latest_version: "v3.5.0" },
        { name: "web-2", current_version: "v3.0.0", latest_version: "v3.5.0" },
      ],
    });
    expect(body).toContain("web-1: v3.1.2 → v3.5.0");
    expect(body).toContain("web-2: v3.0.0 → v3.5.0");
  });

  test("truncates long command output", () => {
    const body = buildBody({
      event: "backup_failed",
      database_name: "postgres-main",
      error_output: "x".repeat(5000),
    });
    expect(body.length).toBeLessThan(1000);
    expect(body).toContain("…");
  });

  test("keeps the body under the ntfy attachment threshold", () => {
    const body = buildBody({
      event: "task_failed",
      task_name: "nightly-prune",
      output: "y".repeat(100000),
    });
    expect(Buffer.byteLength(body, "utf8")).toBeLessThan(4096);
  });

  test("falls back to generic fields for unknown payloads", () => {
    const body = buildBody({
      event: "deployment.completed",
      type: "deployment",
      status: "success",
      project: "my-app",
      environment: "production",
      message: "Deploy finished",
      timestamp: "2026-03-28T07:00:00Z",
      data: { commit: "abc123", branch: "main", url: "https://my-app.example.com" },
    });

    expect(body).toContain("Deploy finished");
    expect(body).toContain("Type: deployment");
    expect(body).toContain("Status: success");
    expect(body).toContain("Project: my-app");
    expect(body).toContain("Environment: production");
    expect(body).toContain("Commit: abc123");
    expect(body).toContain("Branch: main");
    expect(body).toContain("Time: 2026-03-28T07:00:00Z");
    expect(body).not.toContain("Event:");
  });

  test("returns JSON for empty payload", () => {
    expect(buildBody({})).toBe("{}");
  });
});

describe("getPriority", () => {
  test("sends failures at high priority", () => {
    expect(getPriority(deploymentFailed)).toBe("high");
    expect(getPriority(serverUnreachable)).toBe("high");
    expect(getPriority({ event: "container_stopped" })).toBe("high");
    expect(getPriority({ event: "backup_failed" })).toBe("high");
    expect(getPriority({ event: "task_failed" })).toBe("high");
    expect(getPriority({ event: "high_disk_usage" })).toBe("high");
    expect(getPriority({ event: "restart_limit_reached" })).toBe("high");
  });

  test("sends successes at default priority", () => {
    expect(getPriority(deploymentSuccess)).toBe("default");
    expect(getPriority(serverReachable)).toBe("default");
    expect(getPriority({ event: "backup_success" })).toBe("default");
  });

  test("does not escalate advisory events that report success:false", () => {
    expect(getPriority({ event: "server_patch_check", success: false })).toBe("default");
    expect(getPriority({ event: "traefik_version_outdated", success: false })).toBe("default");
    expect(getPriority({ event: "backup_success_with_s3_warning", success: false })).toBe("default");
  });

  test("falls back to success flag for unknown events", () => {
    expect(getPriority({ event: "some_future_event", success: false })).toBe("high");
    expect(getPriority({ event: "some_future_event", success: true })).toBe("default");
  });

  test("falls back to keyword matching for generic payloads", () => {
    expect(getPriority({ status: "success" })).toBe("default");
    expect(getPriority({ event: "deployment.completed" })).toBe("default");
    expect(getPriority({ status: "error" })).toBe("high");
    expect(getPriority({ status: "failed" })).toBe("high");
    expect(getPriority({ type: "deployment_failure" })).toBe("high");
    expect(getPriority({ event: "build.failed" })).toBe("high");
    expect(getPriority({ status: "crashed" })).toBe("high");
    expect(getPriority({ status: "timeout" })).toBe("high");
    expect(getPriority({})).toBe("default");
  });

  test("is case-insensitive", () => {
    expect(getPriority({ status: "FAILED" })).toBe("high");
    expect(getPriority({ status: "Error" })).toBe("high");
    expect(getPriority({ status: "SUCCESS" })).toBe("default");
  });
});

describe("buildTags", () => {
  test("picks a tag matching the event", () => {
    expect(buildTags(deploymentSuccess)).toBe("white_check_mark");
    expect(buildTags(deploymentFailed)).toBe("rotating_light");
    expect(buildTags(serverUnreachable)).toBe("rotating_light");
    expect(buildTags({ event: "high_disk_usage" })).toBe("floppy_disk");
    expect(buildTags({ event: "server_patch_check" })).toBe("package");
    expect(buildTags({ event: "container_restarted" })).toBe("arrows_counterclockwise");
  });

  test("falls back to priority for unknown payloads", () => {
    expect(buildTags({ status: "success" })).toBe("white_check_mark");
    expect(buildTags({ status: "error" })).toBe("rotating_light");
  });
});

describe("buildLinks", () => {
  test("puts the live application first on success and the logs first on failure", () => {
    expect(buildLinks(deploymentSuccess)[0]).toEqual({
      label: "Open application",
      url: "https://api.atlas.dev",
    });
    expect(buildLinks(deploymentFailed)[0].label).toBe("Deployment logs");
  });

  test("adds a scheme to a bare fqdn", () => {
    const links = buildLinks({ ...deploymentSuccess, fqdn: "api.atlas.dev" });
    expect(links[0].url).toBe("https://api.atlas.dev");
  });

  test("uses only the first fqdn when Coolify sends a list", () => {
    const links = buildLinks({ ...deploymentSuccess, fqdn: "https://a.dev,https://b.dev" });
    expect(links[0].url).toBe("https://a.dev");
  });

  test("drops links the payload does not carry", () => {
    const { fqdn, ...withoutFqdn } = deploymentSuccess;
    const links = buildLinks(withoutFqdn);
    expect(links).toHaveLength(1);
    expect(links[0].label).toBe("Deployment logs");
  });

  test("returns nothing when there is no link at all", () => {
    expect(buildLinks({ event: "traefik_version_outdated", servers: [] })).toEqual([]);
  });
});

describe("sendNotification", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    delete global.fetch;
  });

  function headersOf() {
    return fetchMock.mock.calls[0][1].headers;
  }

  /** Undo the RFC 2047 encoding ntfy decodes server-side. */
  function decodeHeader(value) {
    const match = /^=\?UTF-8\?B\?(.*)\?=$/.exec(value);
    return match ? Buffer.from(match[1], "base64").toString("utf8") : value;
  }

  test("sends the title, priority and tags as headers", async () => {
    await sendNotification(deploymentFailed);
    const headers = headersOf();
    expect(decodeHeader(headers.Title)).toBe("api · Deployment failed");
    expect(headers.Priority).toBe("high");
    expect(headers.Tags).toBe("rotating_light");
  });

  test("leaves a plain ASCII title unencoded", async () => {
    await sendNotification({ unrecognised: true });
    expect(headersOf().Title).toBe("Coolify Webhook");
  });

  test("makes the notification tappable and adds the secondary link as a button", async () => {
    await sendNotification(deploymentSuccess);
    const headers = headersOf();
    expect(headers.Click).toBe("https://api.atlas.dev");
    expect(headers.Actions).toBe(
      `view, 'Deployment logs', '${deploymentSuccess.deployment_url}'`
    );
  });

  test("omits the click and action headers when there is no link", async () => {
    await sendNotification({ event: "traefik_version_outdated", servers: [] });
    const headers = headersOf();
    expect(headers.Click).toBeUndefined();
    expect(headers.Actions).toBeUndefined();
  });

  test("RFC 2047-encodes a title so header-unsafe names cannot break the request", async () => {
    await sendNotification({ ...serverUnreachable, server_name: "sunucu-münchen" });
    const encoded = headersOf().Title;
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);

    const decoded = Buffer.from(encoded.slice(10, -2), "base64").toString("utf8");
    expect(decoded).toBe("sunucu-münchen · Server unreachable");
  });

  test("reports the ntfy response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(sendNotification(serverReachable)).resolves.toEqual({ ok: false, status: 503 });
  });
});

describe("describePayload", () => {
  test("names the event and what it is about", () => {
    expect(describePayload(deploymentSuccess)).toEqual({
      event: "deployment_success",
      recognised: true,
      subject: "api",
      success: true,
    });
  });

  test("uses the catalog subject, not the application name, for a server event", () => {
    expect(describePayload(serverUnreachable)).toMatchObject({
      event: "server_unreachable",
      subject: "hetzner-fsn1",
      success: false,
    });
  });

  test("marks an event outside the catalog and falls back to a generic subject", () => {
    expect(describePayload({ event: "future_event", database_name: "orders" })).toEqual({
      event: "future_event",
      recognised: false,
      subject: "orders",
      success: undefined,
    });
  });

  test("falls back to type or status when there is no event", () => {
    expect(describePayload({ type: "deployment", status: "failed" })).toMatchObject({
      event: "deployment",
      recognised: false,
    });
    expect(describePayload({ status: "failed" })).toMatchObject({ event: "failed" });
  });

  test("reports an unknown event for a payload carrying nothing to go on", () => {
    expect(describePayload({ unrecognised: true })).toEqual({
      event: "unknown",
      recognised: false,
      subject: null,
      success: undefined,
    });
  });
});
