const fs = require("node:fs");
const path = require("node:path");
const sherpaOnnx = require("sherpa-onnx-node");

const MODEL_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "models",
  "wespeaker_en_voxceleb_CAM++_LM.onnx",
);

let extractor;

function getExtractor() {
  if (extractor) return extractor;
  if (!fs.existsSync(MODEL_PATH)) {
    throw new Error("Speaker embedding model is missing. Run `npm run setup-voice-model` in Server.");
  }

  extractor = new sherpaOnnx.SpeakerEmbeddingExtractor({
    model: MODEL_PATH,
    numThreads: 1,
    debug: false,
  });
  return extractor;
}

function unitNormalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error("The voice sample did not produce a usable speaker embedding.");
  }
  return vector.map((value) => value / norm);
}

function createVoiceprint(clips) {
  const model = getExtractor();
  const embeddings = clips.map((samples) => {
    const stream = model.createStream();
    stream.acceptWaveform({ sampleRate: 16000, samples });
    const embedding = model.compute(stream);
    if (!embedding.length) {
      throw new Error("The speaker model returned an empty embedding.");
    }
    return Array.from(embedding);
  });

  const dimension = embeddings[0].length;
  if (embeddings.some((embedding) => embedding.length !== dimension)) {
    throw new Error("Speaker model returned embeddings with inconsistent dimensions.");
  }

  const average = Array.from({ length: dimension }, (_, index) =>
    embeddings.reduce((sum, embedding) => sum + embedding[index], 0) / embeddings.length,
  );
  return unitNormalize(average);
}

function compareVoiceprint(samples, voiceprint) {
  const model = getExtractor();
  const stream = model.createStream();
  stream.acceptWaveform({ sampleRate: 16000, samples });
  const embedding = Array.from(model.compute(stream));
  if (!embedding.length || embedding.length !== voiceprint.length) {
    throw new Error("The speaker model returned an incompatible embedding.");
  }

  const normalizedEmbedding = unitNormalize(embedding);
  const score = normalizedEmbedding.reduce(
    (sum, value, index) => sum + value * voiceprint[index],
    0,
  );
  if (!Number.isFinite(score)) {
    throw new Error("The speaker model returned an invalid similarity score.");
  }
  return Math.max(-1, Math.min(1, score));
}

function isVoiceModelAvailable() {
  return fs.existsSync(MODEL_PATH);
}

module.exports = { compareVoiceprint, createVoiceprint, isVoiceModelAvailable };
