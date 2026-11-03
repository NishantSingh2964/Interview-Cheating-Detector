import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
  console.warn("onnxruntime-web is not installed; object detection cannot load.");
}

const mediaSrc = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const mediaDest = path.join(root, "public", "mediapipe");
if (existsSync(mediaSrc)) {
  mkdirSync(mediaDest, { recursive: true });
  cpSync(mediaSrc, mediaDest, { recursive: true });
  console.log("Copied MediaPipe wasm to public/mediapipe");
} else {
  console.warn("@mediapipe/tasks-vision is not installed; face detection cannot load.");
}

const modelDest = path.join(root, "public", "models", "face_landmarker.task");
mkdirSync(path.dirname(modelDest), { recursive: true });
if (!existsSync(modelDest)) {
  const url =
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download the face landmarker model (${response.status}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(modelDest, bytes);
  console.log(`Downloaded face landmarker (${bytes.length} bytes)`);
} else {
  console.log("Face landmarker model already present");
}
