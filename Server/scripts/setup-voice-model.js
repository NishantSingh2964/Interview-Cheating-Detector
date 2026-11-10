const { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const modelPath = path.resolve(__dirname, "..", "models", "wespeaker_en_voxceleb_CAM++_LM.onnx");
const temporaryPath = `${modelPath}.download`;
const modelUrl =
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_CAM%2B%2B_LM.onnx";

async function main() {
  if (existsSync(modelPath)) {
    console.log("Speaker embedding model already exists.");
    return;
  }

  mkdirSync(path.dirname(modelPath), { recursive: true });

  try {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Model download failed (${response.status} ${response.statusText}).`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1_000_000) {
      throw new Error("The speaker embedding model download was unexpectedly small.");
    }

    writeFileSync(temporaryPath, bytes);
    renameSync(temporaryPath, modelPath);
    console.log(`Downloaded English CAM++ speaker embedding model (${bytes.length} bytes).`);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}

main().catch((error) => {
  console.error("[setup-voice-model]", error);
  process.exitCode = 1;
});
