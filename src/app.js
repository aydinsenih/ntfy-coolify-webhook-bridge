const express = require("express");
const crypto = require("crypto");
const { sendNotification, getPriority, buildTitle, describePayload } = require("./ntfy");
const logger = require("./logger");

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

function isValidKey(provided, expected) {
  if (typeof provided !== "string") return false;
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

app.post("/webhook", async (req, res) => {
  const webhookSecret = process.env.WEBHOOK_SECRET;

  if (webhookSecret && !isValidKey(req.query.key, webhookSecret)) {
    logger.warn("Rejected webhook", { reason: "invalid or missing key", ip: req.ip });
    return res.status(401).json({ error: "Unauthorized: invalid or missing key" });
  }

  const payload = req.body;

  if (!payload || Object.keys(payload).length === 0) {
    logger.warn("Rejected webhook", { reason: "empty payload", ip: req.ip });
    return res.status(400).json({ error: "Empty payload" });
  }

  const received = describePayload(payload);

  logger.info("Received webhook", received);
  logger.debug("Received payload", { body: JSON.stringify(payload) });

  try {
    const result = await sendNotification(payload);
    const priority = getPriority(payload);
    const title = buildTitle(payload);

    if (result.ok) {
      return res.json({
        message: "Notification sent",
        priority,
        title,
      });
    }

    return res.status(502).json({
      error: "Failed to send notification to ntfy",
      ntfyStatus: result.status,
    });
  } catch (err) {
    logger.error("Failed to reach ntfy", { ...received, details: err.message });
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

module.exports = app;
