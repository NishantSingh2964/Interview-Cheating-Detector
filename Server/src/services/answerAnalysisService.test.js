const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAiLikelihoodBand,
  validateReview,
  reviewAnswer,
  MIN_REVIEW_WORDS,
} = require("./answerAnalysisService");

test("validates an integer AI-likeness score from 0 to 100", () => {
  assert.deepEqual(validateReview({ aiLikelihoodScore: 72 }), { aiLikelihoodScore: 72 });
  assert.deepEqual(validateReview({ aiLikelihoodScore: "0" }), { aiLikelihoodScore: 0 });
  assert.deepEqual(validateReview({ aiLikelihoodScore: 100 }), { aiLikelihoodScore: 100 });
  for (const aiLikelihoodScore of [-1, 101, 2.5, "uncertain", undefined]) {
    assert.throws(
      () => validateReview({ aiLikelihoodScore }),
      /expected an integer from 0 to 100/,
    );
  }
  assert.throws(() => validateReview(null), /invalid AI-likelihood estimate/);
});

test("classifies exact AI-likeness band boundaries", () => {
  assert.equal(getAiLikelihoodBand(null), "not_scored");
  assert.equal(getAiLikelihoodBand(0), "low");
  assert.equal(getAiLikelihoodBand(39), "low");
  assert.equal(getAiLikelihoodBand(40), "inconclusive");
  assert.equal(getAiLikelihoodBand(69), "inconclusive");
  assert.equal(getAiLikelihoodBand(70), "high");
  assert.equal(getAiLikelihoodBand(100), "high");
  assert.equal(getAiLikelihoodBand(101), "not_scored");
});

test("short answers are saved without requesting or inventing a score", async () => {
  const result = await reviewAnswer("Question", Array(MIN_REVIEW_WORDS - 1).fill("word").join(" "));
  assert.deepEqual(result, { aiLikelihoodScore: null });
});

test("sends a score-only structured request to Ollama", async () => {
  const originalFetch = global.fetch;
  const originalProvider = process.env.ANSWER_REVIEW_PROVIDER;
  const originalApiKey = process.env.OLLAMA_API_KEY;
  const originalModel = process.env.OLLAMA_MODEL;
  process.env.ANSWER_REVIEW_PROVIDER = "ollama";
  process.env.OLLAMA_API_KEY = "test-key";
  process.env.OLLAMA_MODEL = "test-model";
  global.fetch = async (url, options) => {
    assert.equal(url, "https://ollama.com/api/chat");
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body.format.properties), ["aiLikelihoodScore"]);
    assert.deepEqual(Object.keys(JSON.parse(body.messages[1].content)).sort(), ["answer", "question"]);
    assert.match(body.messages[0].content, /not a calibrated probability/);
    assert.match(body.messages[0].content, /not a proof of who it wrote it|proof of who wrote it/);
    assert.doesNotMatch(body.messages[0].content, /follow_up_suggested|followUpQuestion/);
    return new Response(JSON.stringify({
      message: { content: JSON.stringify({ aiLikelihoodScore: 51 }) },
    }), { headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await reviewAnswer("Explain your approach.", Array(MIN_REVIEW_WORDS).fill("word").join(" "));
    assert.deepEqual(result, { aiLikelihoodScore: 51 });
  } finally {
    global.fetch = originalFetch;
    if (originalProvider === undefined) delete process.env.ANSWER_REVIEW_PROVIDER;
    else process.env.ANSWER_REVIEW_PROVIDER = originalProvider;
    if (originalApiKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.OLLAMA_MODEL;
    else process.env.OLLAMA_MODEL = originalModel;
  }
});

test("sends an OpenRouter score-only request and validates the score", async () => {
  const originalFetch = global.fetch;
  const originalProvider = process.env.ANSWER_REVIEW_PROVIDER;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;
  process.env.ANSWER_REVIEW_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/free-model";
  global.fetch = async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.match(body.messages[0].content, /integer from 0 to 100/);
    assert.doesNotMatch(body.messages[0].content, /follow_up_suggested|followUpQuestion/);
    return new Response(JSON.stringify({
      choices: [{
        message: { content: JSON.stringify({ aiLikelihoodScore: 63 }) },
      }],
    }), { headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await reviewAnswer("Explain your approach.", Array(MIN_REVIEW_WORDS).fill("word").join(" "));
    assert.deepEqual(result, { aiLikelihoodScore: 63 });
  } finally {
    global.fetch = originalFetch;
    if (originalProvider === undefined) delete process.env.ANSWER_REVIEW_PROVIDER;
    else process.env.ANSWER_REVIEW_PROVIDER = originalProvider;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = originalModel;
  }
});

test("reports OpenRouter 429 as a retryable rate limit", async () => {
  const originalFetch = global.fetch;
  const originalProvider = process.env.ANSWER_REVIEW_PROVIDER;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;
  process.env.ANSWER_REVIEW_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/free-model";
  global.fetch = async () => new Response(
    JSON.stringify({ error: { code: 429, message: "Provider returned error" } }),
    { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "45" } },
  );
  try {
    await assert.rejects(
      reviewAnswer("Explain your approach.", Array(MIN_REVIEW_WORDS).fill("word").join(" ")),
      (error) => error.statusCode === 429 &&
        /OpenRouter rate limit reached/.test(error.message) &&
        /Retry after 45 seconds/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
    if (originalProvider === undefined) delete process.env.ANSWER_REVIEW_PROVIDER;
    else process.env.ANSWER_REVIEW_PROVIDER = originalProvider;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = originalModel;
  }
});

test("reports OpenRouter 402 with the provider's safe error message", async () => {
  const originalFetch = global.fetch;
  const originalProvider = process.env.ANSWER_REVIEW_PROVIDER;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;
  process.env.ANSWER_REVIEW_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/free-model";
  global.fetch = async () => new Response(
    JSON.stringify({ error: { code: 402, message: "No credits remaining." } }),
    { status: 402, headers: { "Content-Type": "application/json" } },
  );
  try {
    await assert.rejects(
      reviewAnswer("Explain your approach.", Array(MIN_REVIEW_WORDS).fill("word").join(" ")),
      (error) => error.statusCode === 402 &&
        /selected model is free/.test(error.message) &&
        /No credits remaining/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
    if (originalProvider === undefined) delete process.env.ANSWER_REVIEW_PROVIDER;
    else process.env.ANSWER_REVIEW_PROVIDER = originalProvider;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = originalModel;
  }
});

test("reports an OpenRouter timeout as retryable", async () => {
  const originalFetch = global.fetch;
  const originalTimeout = AbortSignal.timeout;
  const originalProvider = process.env.ANSWER_REVIEW_PROVIDER;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  const originalModel = process.env.OPENROUTER_MODEL;
  process.env.ANSWER_REVIEW_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_MODEL = "test/free-model";
  AbortSignal.timeout = () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Timed out", "TimeoutError"));
    return controller.signal;
  };
  global.fetch = async (_url, options) => {
    throw options.signal.reason;
  };
  try {
    await assert.rejects(
      reviewAnswer("Explain your approach.", Array(MIN_REVIEW_WORDS).fill("word").join(" ")),
      (error) => error.statusCode === 504 && /did not respond before the timeout/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
    if (originalProvider === undefined) delete process.env.ANSWER_REVIEW_PROVIDER;
    else process.env.ANSWER_REVIEW_PROVIDER = originalProvider;
    if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = originalModel;
  }
});
