const { createHmac } = require("node:crypto");

function createAutoProctorCredentials(testAttemptId, env = process.env) {
  if (typeof testAttemptId !== "string" || !testAttemptId || testAttemptId.length > 40) {
    const error = new Error("AutoProctor requires a test attempt ID of 1 to 40 characters.");
    error.statusCode = 400;
    throw error;
  }

  const clientId = env.AUTOPROCTOR_CLIENT_ID?.trim();
  const clientSecret = env.AUTOPROCTOR_CLIENT_SECRET;
  if (!clientId || !clientSecret?.trim()) {
    const error = new Error("AutoProctor is not configured on the server.");
    error.statusCode = 503;
    throw error;
  }

  const hashedTestAttemptId = createHmac("sha256", clientSecret)
    .update(testAttemptId)
    .digest("base64");

  return { clientId, testAttemptId, hashedTestAttemptId };
}

module.exports = { createAutoProctorCredentials };
