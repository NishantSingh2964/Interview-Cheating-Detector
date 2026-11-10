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

const objectModelDest = path.join(root, "public", "models", "yolov8n.onnx");
if (!existsSync(objectModelDest)) {
  const url =
    "https://huggingface.co/s1777/yolo-v8n-onnx/resolve/8723d02c28498aebfbca2a7b4df49bf231b4737b/yolov8n.onnx";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download the object detection model (${response.status}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_000_000) {
    throw new Error("The object detection model download was unexpectedly small.");
  }
  writeFileSync(objectModelDest, bytes);
  console.log(`Downloaded object detection model (${bytes.length} bytes)`);
} else {
  console.log("Object detection model already present");
}
