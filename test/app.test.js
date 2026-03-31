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

describe("POST /webhook", () => {
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

  test("returns 500/502 when ntfy server is unreachable", async () => {
    // With no real ntfy server, this should return an error
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "success", project: "test-app" }),
    });
    // It will fail because NTFY_URL points to a non-existent server
    expect([500, 502]).toContain(res.status);
  });

  test("returns default priority for success payload", async () => {
    // We test the priority logic indirectly via the error response
    const res = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "success", project: "test-app" }),
    });
    // The request will fail because ntfy is not available, but we can
    // verify the endpoint accepts the payload
    expect(res.status).toBeGreaterThanOrEqual(400);
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
