const test = require("node:test");
const assert = require("node:assert/strict");

const modelPath = require.resolve("../models/AnswerAnalysis");
const servicePath = require.resolve("./answerAnalysisService");
const queuePath = require.resolve("./answerReviewQueue");
const originalModelModule = require.cache[modelPath];
const originalServiceModule = require.cache[servicePath];
let answerReview;
let updated;

const fakeModel = {
  updateOne: async (filter, update) => {
    updated = { filter, update };
    return { modifiedCount: 1 };
  },
};
const fakeService = {
  reviewAnswer: async () => answerReview(),
};

require.cache[modelPath] = {
  id: modelPath,
  filename: modelPath,
  loaded: true,
  exports: fakeModel,
};
require.cache[servicePath] = {
  id: servicePath,
  filename: servicePath,
  loaded: true,
  exports: fakeService,
};
delete require.cache[queuePath];
const { MAX_ATTEMPTS, processJob } = require("./answerReviewQueue");

test.after(() => {
  delete require.cache[queuePath];
  if (originalModelModule) require.cache[modelPath] = originalModelModule;
  else delete require.cache[modelPath];
  if (originalServiceModule) require.cache[servicePath] = originalServiceModule;
  else delete require.cache[servicePath];
});

test("marks a successfully scored job complete", async () => {
  answerReview = async () => ({ aiLikelihoodScore: 62 });
  updated = null;
  await processJob({
    _id: "job-success",
    processingToken: "token-success",
    attempts: 1,
    prompt: "Question?",
    answer: "Answer",
  });
  assert.equal(updated.filter.processingToken, "token-success");
  assert.equal(updated.update.$set.processingStatus, "completed");
  assert.equal(updated.update.$set.aiLikelihoodScore, 62);
  assert.equal(updated.update.$set.lastError, null);
});

test("requeues a retryable failure using Retry-After", async () => {
  answerReview = async () => {
    const error = new Error("Too many requests");
    error.statusCode = 429;
    error.retryAfterMs = 3000;
    throw error;
  };
  updated = null;
  const now = 10000;
  await processJob({
    _id: "job-retry",
    processingToken: "token-retry",
    attempts: 2,
    prompt: "Question?",
    answer: "Answer",
  }, now);
  assert.equal(updated.update.$set.processingStatus, "queued");
  assert.equal(updated.update.$set.nextAttemptAt.getTime(), now + 3000);
  assert.equal(updated.update.$set.lastError, "Too many requests");
});

test("marks permanent errors and exhausted retries failed", async () => {
  answerReview = async () => {
    const error = new Error("Invalid model configuration");
    error.statusCode = 400;
    error.retryable = false;
    throw error;
  };
  updated = null;
  await processJob({
    _id: "job-permanent",
    processingToken: "token-permanent",
    attempts: 1,
    prompt: "Question?",
    answer: "Answer",
  });
  assert.equal(updated.update.$set.processingStatus, "failed");
  assert.equal(updated.update.$set.nextAttemptAt, null);

  answerReview = async () => {
    const error = new Error("Provider unavailable");
    error.statusCode = 503;
    throw error;
  };
  updated = null;
  await processJob({
    _id: "job-exhausted",
    processingToken: "token-exhausted",
    attempts: MAX_ATTEMPTS,
    prompt: "Question?",
    answer: "Answer",
  });
  assert.equal(updated.update.$set.processingStatus, "failed");
});
