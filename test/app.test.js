const app = require("../src/app");
const http = require("http");

let server;
let baseUrl;

beforeAll((done) => {
  server = http.createServer(app);
  server.listen(0, () => {
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });
});

/**
 * The bridge and the test client both use global fetch, so the mock forwards
 * anything aimed at the test server and only stands in for the ntfy call.
 */
const realFetch = global.fetch;
let ntfyResponse;

beforeEach(() => {
  ntfyResponse = { ok: true, status: 200 };
  global.fetch = jest.fn((url, options) => {
    if (String(url).startsWith(baseUrl)) return realFetch(url, options);
    return typeof ntfyResponse === "function"
      ? ntfyResponse()
      : Promise.resolve(ntfyResponse);
  });
});

afterEach(() => {
  global.fetch = realFetch;
});

describe("POST /webhook", () => {
  const deployment = {
    success: true,
    message: "New version successfully deployed",
    event: "deployment_success",
    application_name: "api",
    project: "atlas",
    environment: "production",
    fqdn: "https://api.atlas.dev",
  };

  test("returns 400 for empty payload", async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Empty payload");
  });

  test("forwards the notification and echoes the resolved title", async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deployment),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("Notification sent");
    expect(body.priority).toBe("default");
    expect(body.title).toBe("api · Deployment successful");
  });

  test("returns 502 when ntfy rejects the notification", async () => {
    ntfyResponse = { ok: false, status: 503 };

    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deployment),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ntfyStatus).toBe(503);
  });

  test("returns 500 when the ntfy server is unreachable", async () => {
    ntfyResponse = () => Promise.reject(new Error("connect ECONNREFUSED"));

    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deployment),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
  });
});

describe("POST /webhook with WEBHOOK_SECRET", () => {
  const originalSecret = process.env.WEBHOOK_SECRET;

  beforeAll(() => {
    process.env.WEBHOOK_SECRET = "test-secret";
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.WEBHOOK_SECRET;
    } else {
      process.env.WEBHOOK_SECRET = originalSecret;
    }
  });

  test("returns 401 when key query parameter is missing", async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "success", project: "test-app" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized: invalid or missing key");
  });

  test("returns 401 when key query parameter is incorrect", async () => {
    const res = await fetch(`${baseUrl}/webhook?key=wrong-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "success", project: "test-app" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized: invalid or missing key");
  });

  test("allows request when key query parameter matches WEBHOOK_SECRET", async () => {
    const res = await fetch(`${baseUrl}/webhook?key=test-secret`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "success", project: "test-app" }),
    });
    // Should pass auth check — will fail later because ntfy is not available
    expect(res.status).not.toBe(401);
  });
});

describe("logging", () => {
  let out;
  let err;

  beforeEach(() => {
    process.env.LOG_LEVEL = "info";
    out = jest.spyOn(console, "log").mockImplementation(() => {});
    err = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.LOG_LEVEL = "silent";
    jest.restoreAllMocks();
  });

  /** Every line written to a console spy, joined for a single match. */
  function linesOf(spy) {
    return spy.mock.calls.map((call) => call[0]).join("\n");
  }

  function post(payload) {
    return fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  const deployment = {
    success: true,
    event: "deployment_success",
    application_name: "api",
    project: "atlas",
    environment: "production",
    fqdn: "https://api.atlas.dev",
  };

  test("logs the event received and the notification sent", async () => {
    await post(deployment);

    const lines = linesOf(out);
    expect(lines).toContain(
      "INFO Received webhook event=deployment_success recognised=true subject=api success=true"
    );
    expect(lines).toContain("INFO Sent notification");
    expect(lines).toContain('title="api · Deployment successful"');
    expect(lines).toContain("priority=default");
    expect(lines).toContain("status=200");
  });

  test("names what it could not recognise", async () => {
    await post({ status: "success", project: "test-app" });

    expect(linesOf(out)).toContain(
      "INFO Received webhook event=success recognised=false subject=test-app"
    );
  });

  test("logs the whole payload only at debug level", async () => {
    await post(deployment);
    expect(linesOf(out)).not.toContain("Received payload");

    process.env.LOG_LEVEL = "debug";
    await post(deployment);
    expect(linesOf(out)).toContain('Received payload body="{');
  });

  test("logs a rejected webhook as a warning", async () => {
    await post({});

    expect(linesOf(err)).toContain('WARN Rejected webhook reason="empty payload"');
    expect(linesOf(out)).not.toContain("Received webhook");
  });

  test("logs an ntfy rejection with its status", async () => {
    ntfyResponse = { ok: false, status: 503 };
    await post(deployment);

    expect(linesOf(err)).toContain("ERROR ntfy rejected notification");
    expect(linesOf(err)).toContain("status=503");
  });

  test("logs an unreachable ntfy server with the reason", async () => {
    ntfyResponse = () => Promise.reject(new Error("connect ECONNREFUSED"));
    await post(deployment);

    expect(linesOf(err)).toContain("ERROR Failed to reach ntfy");
    expect(linesOf(err)).toContain("event=deployment_success");
    expect(linesOf(err)).toContain('details="connect ECONNREFUSED"');
  });
});
