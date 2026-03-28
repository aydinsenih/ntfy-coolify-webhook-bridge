const { getPriority, buildTitle, buildBody, buildTags } = require("../src/ntfy");

describe("getPriority", () => {
  test("returns 'default' for success status", () => {
    expect(getPriority({ status: "success" })).toBe("default");
  });

  test("returns 'default' for completed event", () => {
    expect(getPriority({ event: "deployment.completed" })).toBe("default");
  });

  test("returns 'high' when status contains 'error'", () => {
    expect(getPriority({ status: "error" })).toBe("high");
  });

  test("returns 'high' when status contains 'failed'", () => {
    expect(getPriority({ status: "failed" })).toBe("high");
  });

  test("returns 'high' when type contains 'failure'", () => {
    expect(getPriority({ type: "deployment_failure" })).toBe("high");
  });

  test("returns 'high' when event contains 'failed'", () => {
    expect(getPriority({ event: "build.failed" })).toBe("high");
  });

  test("returns 'high' when status contains 'crashed'", () => {
    expect(getPriority({ status: "crashed" })).toBe("high");
  });

  test("returns 'high' when status contains 'timeout'", () => {
    expect(getPriority({ status: "timeout" })).toBe("high");
  });

  test("returns 'default' for empty payload", () => {
    expect(getPriority({})).toBe("default");
  });

  test("is case-insensitive", () => {
    expect(getPriority({ status: "FAILED" })).toBe("high");
    expect(getPriority({ status: "Error" })).toBe("high");
    expect(getPriority({ status: "SUCCESS" })).toBe("default");
  });
});

describe("buildTitle", () => {
  test("includes project name and status", () => {
    const title = buildTitle({ project: "my-app", status: "success" });
    expect(title).toContain("my-app");
    expect(title).toContain("success");
  });

  test("uses project_name when project is absent", () => {
    const title = buildTitle({ project_name: "other-app" });
    expect(title).toContain("other-app");
  });

  test("includes event and type", () => {
    const title = buildTitle({ event: "deployment", type: "build", status: "ok" });
    expect(title).toContain("deployment");
    expect(title).toContain("build");
  });

  test("returns default title for empty payload", () => {
    expect(buildTitle({})).toBe("Coolify Webhook");
  });
});

describe("buildBody", () => {
  test("includes all available fields", () => {
    const body = buildBody({
      event: "deployment.completed",
      type: "deployment",
      status: "success",
      project: "my-app",
      environment: "production",
      message: "Deploy finished",
      timestamp: "2026-03-28T07:00:00Z",
      data: {
        commit: "abc123",
        branch: "main",
        url: "https://my-app.example.com",
      },
    });

    expect(body).toContain("Event: deployment.completed");
    expect(body).toContain("Type: deployment");
    expect(body).toContain("Status: success");
    expect(body).toContain("Project: my-app");
    expect(body).toContain("Environment: production");
    expect(body).toContain("Message: Deploy finished");
    expect(body).toContain("Commit: abc123");
    expect(body).toContain("Branch: main");
    expect(body).toContain("URL: https://my-app.example.com");
    expect(body).toContain("Time: 2026-03-28T07:00:00Z");
  });

  test("returns JSON for empty payload", () => {
    const body = buildBody({});
    expect(body).toBe("{}");
  });
});

describe("buildTags", () => {
  test("returns check mark for success", () => {
    expect(buildTags({ status: "success" })).toBe("white_check_mark");
  });

  test("returns rotating light for error", () => {
    expect(buildTags({ status: "error" })).toBe("rotating_light");
  });
});
