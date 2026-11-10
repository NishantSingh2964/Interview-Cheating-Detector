const MAX_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 60000;

function isRetryableError(error) {
  if (typeof error?.retryable === "boolean") return error.retryable;
  return error?.statusCode === 408 ||
    error?.statusCode === 429 ||
    (Number.isInteger(error?.statusCode) && error.statusCode >= 500);
}

function getRetryDelayMs(attempt, retryAfterMs = null, random = Math.random) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.max(retryAfterMs, INITIAL_RETRY_DELAY_MS);
  }
  const exponentialDelay = Math.min(
    INITIAL_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1)),
    MAX_RETRY_DELAY_MS,
  );
  return Math.min(
    Math.round(exponentialDelay * (0.75 + random() * 0.5)),
    MAX_RETRY_DELAY_MS,
  );
}

function parseRetryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - now);
}

module.exports = {
  MAX_ATTEMPTS,
  INITIAL_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  getRetryDelayMs,
  isRetryableError,
  parseRetryAfterMs,
};
