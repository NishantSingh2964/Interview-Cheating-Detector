const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateVoiceWindow } = require("./voiceDecisionService");

test("does not flag until the full speech window is available", () => {
  assert.deepEqual(evaluateVoiceWindow([true, true], 3, 2), {
    ready: false,
    lowScores: 2,
    flagged: false,
  });
});

test("flags two low scores in a full three-segment window", () => {
  assert.deepEqual(evaluateVoiceWindow([true, false, true], 3, 2), {
    ready: true,
    lowScores: 2,
    flagged: true,
  });
});

test("does not flag one low score in a full window", () => {
  assert.deepEqual(evaluateVoiceWindow([true, false, false], 3, 2), {
    ready: true,
    lowScores: 1,
    flagged: false,
  });
});

test("flags three low scores in a full window", () => {
  assert.deepEqual(evaluateVoiceWindow([true, true, true], 3, 2), {
    ready: true,
    lowScores: 3,
    flagged: true,
  });
});
