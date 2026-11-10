const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getRetryDelayMs,
  isRetryableError,
  parseRetryAfterMs,
} = require("./answerReviewQueuePolicy");

test("retries throttles, timeouts, network failures, and server errors only", () => {
  assert.equal(isRetryableError({ statusCode: 429 }), true);
  assert.equal(isRetryableError({ statusCode: 504 }), true);
  assert.equal(isRetryableError({ statusCode: 503 }), true);
  assert.equal(isRetryableError({ statusCode: 400 }), false);
  assert.equal(isRetryableError({ statusCode: 402 }), false);
  assert.equal(isRetryableError({ retryable: true }), true);
  assert.equal(isRetryableError({ retryable: false, statusCode: 503 }), false);
});

test("uses Retry-After and bounded exponential backoff", () => {
  assert.equal(getRetryDelayMs(1, null, () => 0.5), 1000);
  assert.equal(getRetryDelayMs(3, null, () => 0.5), 4000);
  assert.equal(getRetryDelayMs(1, 1500), 1500);
  assert.equal(getRetryDelayMs(1, 0), 1000);
  assert.equal(getRetryDelayMs(1, 120000), 120000);
  assert.equal(getRetryDelayMs(10, null, () => 0.5), 60000);
  assert.equal(parseRetryAfterMs("2"), 2000);
  assert.equal(parseRetryAfterMs(null), null);
});

test("parses HTTP-date Retry-After values", () => {
  const now = Date.parse("2026-11-10T00:00:00.000Z");
  assert.equal(
    parseRetryAfterMs("Tue, 10 Nov 2026 00:00:05 GMT", now),
    5000,
  );
});
