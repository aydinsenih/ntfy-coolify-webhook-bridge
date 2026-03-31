const express = require("express");
const crypto = require("crypto");
const { sendNotification, getPriority, buildTitle } = require("./ntfy");

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
    return res.status(401).json({ error: "Unauthorized: invalid or missing key" });
  }

  const payload = req.body;

  if (!payload || Object.keys(payload).length === 0) {
    return res.status(400).json({ error: "Empty payload" });
  }

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
    return res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

module.exports = app;
