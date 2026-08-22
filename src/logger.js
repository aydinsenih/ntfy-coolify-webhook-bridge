/**
 * Minimal structured logger. One line per event — a timestamp, the level, a
 * short message, then the fields as `key=value` pairs — so `docker logs` stays
 * both readable and greppable without pulling in a logging dependency.
 *
 * The level is read from LOG_LEVEL on every call, so it can be flipped in a
 * running process's environment (and in tests) without re-importing.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const DEFAULT_LEVEL = "info";

// Keep one field — a stack trace, clipped command output — from swallowing the
// line. The payload itself is only ever logged at debug level.
const MAX_VALUE_CHARS = 200;

function threshold() {
  const configured = String(process.env.LOG_LEVEL || DEFAULT_LEVEL).toLowerCase();
  return LEVELS[configured] || LEVELS[DEFAULT_LEVEL];
}

/**
 * Render a value as a single token: collapsed onto one line, clipped, and
 * quoted when it contains anything that would break the `key=value` reading.
 */
function formatValue(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  const clipped = text.length <= MAX_VALUE_CHARS ? text : `${text.slice(0, MAX_VALUE_CHARS - 1)}…`;
  return clipped === "" || /[\s"=]/.test(clipped) ? JSON.stringify(clipped) : clipped;
}

/**
 * Fields that carry nothing are dropped, so events only log what they have.
 * `false` and `0` are kept — they are answers, not absences.
 */
function formatFields(fields) {
  return Object.entries(fields || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");
}

function log(level, message, fields) {
  if (LEVELS[level] < threshold()) return;

  const line = [new Date().toISOString(), level.toUpperCase(), message, formatFields(fields)]
    .filter(Boolean)
    .join(" ");

  // Warnings and errors go to stderr so they survive stdout-only filtering.
  (LEVELS[level] >= LEVELS.warn ? console.error : console.log)(line);
}

module.exports = {
  debug: (message, fields) => log("debug", message, fields),
  info: (message, fields) => log("info", message, fields),
  warn: (message, fields) => log("warn", message, fields),
  error: (message, fields) => log("error", message, fields),
};
