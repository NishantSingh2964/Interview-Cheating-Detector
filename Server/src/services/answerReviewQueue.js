const crypto = require("crypto");
const AnswerAnalysis = require("../models/AnswerAnalysis");
const { reviewAnswer } = require("./answerAnalysisService");
const {
  MAX_ATTEMPTS,
  getRetryDelayMs,
  isRetryableError,
} = require("./answerReviewQueuePolicy");

const POLL_INTERVAL_MS = 1000;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const ERROR_MESSAGE_LIMIT = 500;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function claimNextJob(now = new Date()) {
  const token = crypto.randomUUID();
  return AnswerAnalysis.findOneAndUpdate(
    {
      processingStatus: "queued",
      $or: [
        { nextAttemptAt: null },
        { nextAttemptAt: { $lte: now } },
      ],
    },
    {
      $set: {
        processingStatus: "processing",
        lockedAt: now,
        processingToken: token,
        lastError: null,
      },
      $inc: { attempts: 1 },
    },
    {
      new: true,
      sort: { nextAttemptAt: 1, analyzedAt: 1 },
    },
  ).select("+processingToken").lean();
}

async function recoverStaleJobs(now = new Date()) {
  const staleBefore = new Date(now.getTime() - LOCK_TIMEOUT_MS);
  const staleJobs = await AnswerAnalysis.find({
    processingStatus: "processing",
    lockedAt: { $lte: staleBefore },
  }).select("_id attempts").lean();

  for (const job of staleJobs) {
    const exhausted = job.attempts >= MAX_ATTEMPTS;
    await AnswerAnalysis.updateOne(
      {
        _id: job._id,
        processingStatus: "processing",
        attempts: job.attempts,
        lockedAt: { $lte: staleBefore },
      },
      {
        $set: {
          processingStatus: exhausted ? "failed" : "queued",
          nextAttemptAt: exhausted ? null : now,
          lockedAt: null,
          processingToken: null,
          lastError: "Worker stopped before completing this job.",
        },
      },
    );
  }
}

async function processJob(job, now = Date.now()) {
  try {
    const result = await reviewAnswer(job.prompt, job.answer);
    await AnswerAnalysis.updateOne(
      { _id: job._id, processingStatus: "processing", processingToken: job.processingToken },
      {
        $set: {
          aiLikelihoodScore: result.aiLikelihoodScore,
          processingStatus: "completed",
          nextAttemptAt: null,
          lockedAt: null,
          processingToken: null,
          lastError: null,
        },
      },
    );
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Unknown answer scoring error.")
      .slice(0, ERROR_MESSAGE_LIMIT);
    const retry = isRetryableError(error) && job.attempts < MAX_ATTEMPTS;
    const retryDelayMs = retry ? getRetryDelayMs(job.attempts, error.retryAfterMs) : null;
    await AnswerAnalysis.updateOne(
      { _id: job._id, processingStatus: "processing", processingToken: job.processingToken },
      {
        $set: {
          processingStatus: retry ? "queued" : "failed",
          nextAttemptAt: retry
            ? new Date(now + retryDelayMs)
            : null,
          lockedAt: null,
          processingToken: null,
          lastError: message,
        },
      },
    );
    if (retry) {
      console.warn(
        `[answer-review-queue] job ${job._id} will retry (${job.attempts}/${MAX_ATTEMPTS}) in ${Math.max(1, Math.ceil(retryDelayMs / 1000))}s: ${message}`,
      );
    } else {
      console.error(`[answer-review-queue] job ${job._id} failed after ${job.attempts} attempt(s): ${message}`);
    }
  }
}

let workerStarted = false;

async function runWorker() {
  let nextRecoveryAt = 0;
  while (workerStarted) {
    try {
      const now = Date.now();
      if (now >= nextRecoveryAt) {
        await recoverStaleJobs(new Date(now));
        nextRecoveryAt = now + LOCK_TIMEOUT_MS;
      }
      const job = await claimNextJob(new Date());
      if (job) {
        await processJob(job);
      } else {
        await wait(POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error("[answer-review-queue] worker loop failed:", error);
      await wait(POLL_INTERVAL_MS * 5);
    }
  }
}

function startAnswerReviewWorker() {
  if (workerStarted) return;
  workerStarted = true;
  void runWorker();
  console.log("[answer-review-queue] worker started");
}

function stopAnswerReviewWorker() {
  workerStarted = false;
}

module.exports = {
  MAX_ATTEMPTS,
  claimNextJob,
  processJob,
  recoverStaleJobs,
  startAnswerReviewWorker,
  stopAnswerReviewWorker,
};
