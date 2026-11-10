function evaluateVoiceWindow(results, windowSize, requiredLowScores) {
  const lowScores = results.filter(Boolean).length;
  const ready = results.length === windowSize;
  return {
    ready,
    lowScores,
    flagged: ready && lowScores >= requiredLowScores,
  };
}

module.exports = { evaluateVoiceWindow };
