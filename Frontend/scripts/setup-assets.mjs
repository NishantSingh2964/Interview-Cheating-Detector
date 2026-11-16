import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ortSrc = path.join(root, "node_modules", "onnxruntime-web", "dist");
const ortDest = path.join(root, "public", "ort");
mkdirSync(ortDest, { recursive: true });

if (existsSync(ortSrc)) {
  for (const name of readdirSync(ortSrc)) {
    const keep =
      name === "ort.wasm.bundle.min.mjs" ||
      name === "ort.webgpu.bundle.min.mjs" ||
      name.startsWith("ort-wasm-simd-threaded");
    if (!keep) continue;
    copyFileSync(path.join(ortSrc, name), path.join(ortDest, name));
  }
  console.log("Copied ONNX Runtime files to public/ort");
} else {
  console.warn("onnxruntime-web is not installed; speech activity detection cannot load.");
}

const vadSrc = path.join(root, "node_modules", "@ricky0123", "vad-web", "dist");
const vadDest = path.join(root, "public", "vad");
if (existsSync(vadSrc)) {
  mkdirSync(vadDest, { recursive: true });
  for (const name of ["vad.worklet.bundle.min.js", "silero_vad_v5.onnx"]) {
    const source = path.join(vadSrc, name);
    if (!existsSync(source)) {
      throw new Error(`Required VAD asset is missing: ${source}`);
    }
    copyFileSync(source, path.join(vadDest, name));
  }
  console.log("Copied Silero VAD assets to public/vad");
} else {
  console.warn("@ricky0123/vad-web is not installed; speech activity detection cannot load.");
}
