const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const { test } = require("node:test");
const { createAutoProctorCredentials } = require("./autoProctorService");

test("creates the AutoProctor credentials with a base64 HMAC-SHA256 signature", () => {
  const credentials = createAutoProctorCredentials("session-id", {
    AUTOPROCTOR_CLIENT_ID: " client-id ",
    AUTOPROCTOR_CLIENT_SECRET: "secret",
  });

  assert.deepEqual(credentials, {
    clientId: "client-id",
    testAttemptId: "session-id",
    hashedTestAttemptId: createHmac("sha256", "secret")
      .update("session-id")
      .digest("base64"),
  });
  assert.equal("clientSecret" in credentials, false);
});

test("rejects missing AutoProctor credentials", () => {
  assert.throws(() => createAutoProctorCredentials("session-id", {}), {
    statusCode: 503,
    message: "AutoProctor is not configured on the server.",
  });
});

test("rejects unsupported test attempt IDs", () => {
  assert.throws(() => createAutoProctorCredentials("", {
    AUTOPROCTOR_CLIENT_ID: "client-id",
    AUTOPROCTOR_CLIENT_SECRET: "secret",
  }), { statusCode: 400 });
  assert.throws(() => createAutoProctorCredentials("x".repeat(41), {
    AUTOPROCTOR_CLIENT_ID: "client-id",
    AUTOPROCTOR_CLIENT_SECRET: "secret",
  }), { statusCode: 400 });
});
