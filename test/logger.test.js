const logger = require("../src/logger");

let out;
let err;

beforeEach(() => {
  process.env.LOG_LEVEL = "debug";
  out = jest.spyOn(console, "log").mockImplementation(() => {});
  err = jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env.LOG_LEVEL = "silent";
  jest.restoreAllMocks();
});

/** The single line the last console call received. */
function lineOf(spy) {
  return spy.mock.calls[spy.mock.calls.length - 1][0];
}

describe("log lines", () => {
  test("writes a timestamp, the level, the message and the fields", () => {
    logger.info("Received webhook", { event: "deployment_success", subject: "api" });

    expect(lineOf(out)).toMatch(
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO Received webhook event=deployment_success subject=api$/
    );
  });

  test("keeps everything on one line", () => {
    logger.info("Sent notification", { title: "api\nDeployment  successful" });
    expect(lineOf(out)).toBe(
      `${lineOf(out).split(" ")[0]} INFO Sent notification title="api Deployment successful"`
    );
  });

  test("quotes values that would break the key=value reading", () => {
    logger.info("Sent notification", { title: "api · Deployment successful" });
    expect(lineOf(out)).toContain('title="api · Deployment successful"');
  });

  test("leaves a plain value unquoted", () => {
    logger.info("Sent notification", { priority: "high" });
    expect(lineOf(out)).toContain("priority=high");
  });

  test("drops fields that carry nothing but keeps false and zero", () => {
    logger.info("Received webhook", {
      subject: null,
      reason: undefined,
      title: "",
      success: false,
      links: 0,
    });

    const line = lineOf(out);
    expect(line).toContain("success=false");
    expect(line).toContain("links=0");
    expect(line).not.toContain("subject=");
    expect(line).not.toContain("reason=");
    expect(line).not.toContain("title=");
  });

  test("clips a value long enough to swallow the line", () => {
    logger.error("Failed to reach ntfy", { details: "x".repeat(500) });

    const value = /details=(\S+)/.exec(lineOf(err))[1];
    expect(value).toHaveLength(200);
    expect(value.endsWith("…")).toBe(true);
  });

  test("logs a message with no fields", () => {
    logger.info("ntfy-coolify-webhook-bridge listening");
    expect(lineOf(out)).toMatch(/INFO ntfy-coolify-webhook-bridge listening$/);
  });
});

describe("levels", () => {
  test("sends warnings and errors to stderr", () => {
    logger.warn("Rejected webhook", { reason: "empty payload" });
    logger.error("ntfy rejected notification", { status: 503 });

    expect(err).toHaveBeenCalledTimes(2);
    expect(out).not.toHaveBeenCalled();
  });

  test("suppresses anything below LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";

    logger.debug("Received payload", { body: "{}" });
    logger.info("Received webhook", { event: "test" });
    logger.warn("Rejected webhook", { reason: "empty payload" });

    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
  });

  test("silent suppresses every level", () => {
    process.env.LOG_LEVEL = "silent";

    logger.info("Received webhook", { event: "test" });
    logger.error("ntfy rejected notification", { status: 503 });

    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  test("falls back to info when LOG_LEVEL is unset or nonsense", () => {
    delete process.env.LOG_LEVEL;
    logger.debug("Received payload", { body: "{}" });
    expect(out).not.toHaveBeenCalled();

    process.env.LOG_LEVEL = "chatty";
    logger.info("Received webhook", { event: "test" });
    expect(out).toHaveBeenCalledTimes(1);
  });
});
