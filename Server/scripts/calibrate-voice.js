const fs = require("node:fs");
const path = require("node:path");
const { compareVoiceprint, createVoiceprint } = require("../src/services/voiceService");

const SAMPLE_RATE = 16000;
const MIN_SAMPLES = SAMPLE_RATE * 3;
const MAX_SAMPLES = SAMPLE_RATE * 15;

function usage() {
  return [
    "Usage: npm run calibrate-voice -- --reference <dir> --candidate <dir> --other <dir>",
    "Each directory must contain consented WAV clips at least 3 seconds long.",
    "Reference clips build the voiceprint; candidate/other clips are held-out labeled tests.",
  ].join("\n");
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index];
    if (!["--reference", "--candidate", "--other"].includes(key) || !args[index + 1]) {
      throw new Error(usage());
    }
    options[key.slice(2)] = path.resolve(args[index + 1]);
    index += 1;
  }
  if (!options.reference || !options.candidate || !options.other) {
    throw new Error(usage());
  }
  return options;
}

function readWav(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${filePath}: expected a RIFF/WAVE file.`);
  }

  let format;
  let channels;
  let sampleRate;
  let bitsPerSample;
  let audioData;
  for (let offset = 12; offset + 8 <= data.length;) {
    const chunkName = data.toString("ascii", offset, offset + 4);
    const chunkSize = data.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > data.length) throw new Error(`${filePath}: truncated WAV chunk.`);

    if (chunkName === "fmt ") {
      format = data.readUInt16LE(chunkStart);
      channels = data.readUInt16LE(chunkStart + 2);
      sampleRate = data.readUInt32LE(chunkStart + 4);
      bitsPerSample = data.readUInt16LE(chunkStart + 14);
    } else if (chunkName === "data") {
      audioData = data.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (![1, 3].includes(format) || ![1, 2].includes(channels) ||
      ![16, 32].includes(bitsPerSample) || (format === 1 && bitsPerSample !== 16) ||
      (format === 3 && bitsPerSample !== 32) || !sampleRate || !audioData) {
    throw new Error(`${filePath}: supported WAV formats are PCM16 or Float32, mono or stereo.`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(audioData.length / (bytesPerSample * channels));
  const mono = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let value = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = (frame * channels + channel) * bytesPerSample;
      value += format === 1
        ? audioData.readInt16LE(offset) / 32768
        : audioData.readFloatLE(offset);
    }
    mono[frame] = value / channels;
    if (!Number.isFinite(mono[frame]) || Math.abs(mono[frame]) > 1) {
      throw new Error(`${filePath}: WAV contains invalid audio samples.`);
    }
  }

  const targetLength = Math.floor(frameCount * SAMPLE_RATE / sampleRate);
  const samples = new Float32Array(targetLength);
  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = index * sampleRate / SAMPLE_RATE;
    const left = Math.floor(sourcePosition);
    const right = Math.min(left + 1, frameCount - 1);
    const fraction = sourcePosition - left;
    samples[index] = mono[left] * (1 - fraction) + mono[right] * fraction;
  }
  if (samples.length < MIN_SAMPLES || samples.length > MAX_SAMPLES) {
    throw new Error(`${filePath}: each clip must be 3 to 15 seconds after resampling.`);
  }
  return samples;
}

function listWavFiles(directory) {
  if (!fs.statSync(directory).isDirectory()) {
    throw new Error(`${directory}: expected a directory.`);
  }
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".wav"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function loadClips(directory) {
  const files = listWavFiles(directory);
  if (!files.length) throw new Error(`${directory}: no WAV files found.`);
  return files.map((filePath) => ({ filePath, samples: readWav(filePath) }));
}

function evaluateThreshold(threshold, candidateScores, otherScores) {
  const falseAlarms = candidateScores.filter((score) => score < threshold).length;
  const misses = otherScores.filter((score) => score >= threshold).length;
  const falseAlarmRate = falseAlarms / candidateScores.length;
  const missRate = misses / otherScores.length;
  return {
    threshold,
    falseAlarms,
    falseAlarmRate,
    misses,
    missRate,
    balancedAccuracy: 1 - (falseAlarmRate + missRate) / 2,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const referenceClips = loadClips(options.reference);
  const candidateClips = loadClips(options.candidate);
  const otherClips = loadClips(options.other);
  const voiceprint = createVoiceprint(referenceClips.map((clip) => clip.samples));
  const scoreClips = (clips) => clips.map(({ filePath, samples }) => ({
    file: path.basename(filePath),
    score: compareVoiceprint(samples, voiceprint),
  }));
  const candidateScores = scoreClips(candidateClips);
  const otherScores = scoreClips(otherClips);
  const observedScores = [...new Set([
    ...candidateScores.map(({ score }) => score),
    ...otherScores.map(({ score }) => score),
  ])].sort((a, b) => a - b);
  const thresholds = observedScores.map((score, index) => {
    const nextScore = observedScores[index + 1];
    if (nextScore !== undefined) return (score + nextScore) / 2;
    return score < 1 ? (score + 1) / 2 : score;
  });

  console.log("Local voice-threshold calibration");
  console.log(`Reference clips: ${referenceClips.length}`);
  console.log(`Held-out candidate clips: ${candidateScores.length}`);
  console.log(`Held-out other-speaker clips: ${otherScores.length}`);
  console.log("\nScores (higher means more similar to the reference):");
  for (const [label, scores] of [["candidate", candidateScores], ["other", otherScores]]) {
    for (const item of scores) console.log(`  ${label.padEnd(9)} ${item.file}: ${item.score.toFixed(4)}`);
  }
  console.log("\nThreshold results (below threshold is flagged as a voice difference):");
  console.log("Rows cover each distinct decision outcome between observed scores.");
  console.log("threshold | false alarms | misses | balanced accuracy");
  for (const threshold of thresholds) {
    const result = evaluateThreshold(threshold, candidateScores.map((item) => item.score), otherScores.map((item) => item.score));
    console.log(
      `${result.threshold.toFixed(4).padStart(9)} | ` +
      `${`${result.falseAlarms}/${candidateScores.length} (${(result.falseAlarmRate * 100).toFixed(1)}%)`.padEnd(23)} | ` +
      `${`${result.misses}/${otherScores.length} (${(result.missRate * 100).toFixed(1)}%)`.padEnd(18)} | ` +
      `${(result.balancedAccuracy * 100).toFixed(1)}%`,
    );
  }
  console.log("\nChoose a threshold only after reviewing the false-alarm/miss tradeoff across varied, consented recordings.");
  console.log("These results are a small-sample guide, not an accuracy guarantee. No threshold was selected or saved.");
}

try {
  main();
} catch (error) {
  console.error("[calibrate-voice]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
