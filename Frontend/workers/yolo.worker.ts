/**
 * yolo.worker.ts
 * Runs YOLOv8n via ONNX Runtime Web on frames posted from the main thread.
 * Stays off the main thread so the UI never freezes.
 *
 * Expected incoming message: { imageData: ImageData, width: number, height: number }
 * Outgoing message: DetectionBox[]  (or an empty array on error)
 */

import type { DetectionBox } from "@/lib/types";
import { env, InferenceSession, Tensor } from "onnxruntime-web";

// Point ONNX Runtime at the wasm files we copied to public/ort
env.wasm.wasmPaths = "/ort/";

const MODEL_SIZE = 640;
const PHONE_CLASS_INDEX = 67;
const PHONE_DEBUG_MIN_SCORE = 0.05;

/** COCO labels we care about */
const FLAGGED_LABELS = new Set([
  "cell phone", "book", "laptop", "tv", "keyboard", "mouse", "remote",
  "person",
]);

const COCO_LABELS = [
  "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
  "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat",
  "dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack",
  "umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball",
  "kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket",
  "bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple",
  "sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair",
  "couch","potted plant","bed","dining table","toilet","tv","laptop","mouse",
  "remote","keyboard","cell phone","microwave","oven","toaster","sink",
  "refrigerator","book","clock","vase","scissors","teddy bear","hair drier",
  "toothbrush",
];

let session: InferenceSession | null = null;

async function loadModel() {
  const backends: ("webgpu" | "wasm")[] = ["webgpu", "wasm"];
  const errors: string[] = [];
  for (const backend of backends) {
    try {
      session = await InferenceSession.create("/models/yolov8n.onnx", {
        executionProviders: [backend],
      });
      console.log(`[yolo.worker] loaded on ${backend}`);
      return;
    } catch (error) {
      errors.push(`${backend}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not load object detection model (${errors.join("; ")})`);
}

/** Letterbox-resize ImageData → Float32Array [1, 3, 640, 640] in RGB order */
function preprocess(imageData: ImageData, srcW: number, srcH: number): [Float32Array, number, number] {
  const scale = Math.min(MODEL_SIZE / srcW, MODEL_SIZE / srcH);
  const newW = Math.round(srcW * scale);
  const newH = Math.round(srcH * scale);
  const padX = (MODEL_SIZE - newW) / 2;
  const padY = (MODEL_SIZE - newH) / 2;

  // Draw to offscreen canvas
  const oc = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE);
  const octx = oc.getContext("2d")!;
  octx.fillStyle = "#808080"; // YOLO typical letterbox gray
  octx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE);

  // Draw resized frame
  const src = new OffscreenCanvas(srcW, srcH);
  const sctx = src.getContext("2d")!;
  sctx.putImageData(imageData, 0, 0);
  octx.drawImage(src, padX, padY, newW, newH);

  const pixels = octx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  const n = MODEL_SIZE * MODEL_SIZE;
  const tensor = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    tensor[i]         = pixels[i * 4]     / 255; // R
    tensor[i + n]     = pixels[i * 4 + 1] / 255; // G
    tensor[i + n * 2] = pixels[i * 4 + 2] / 255; // B
  }
  return [tensor, padX, padY];
}

/** NMS — keeps the best box per class cluster */
function nms(boxes: DetectionBox[], iouThresh: number): DetectionBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const keep: DetectionBox[] = [];
  const suppressed = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    keep.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue;
      if (iou(sorted[i], sorted[j]) > iouThresh) suppressed.add(j);
    }
  }
  return keep;
}

function iou(a: DetectionBox, b: DetectionBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (!inter) return 0;
  const aArea = a.width * a.height;
  const bArea = b.width * b.height;
  return inter / (aArea + bArea - inter);
}

/** Run inference and decode output */
async function detect(
  imageData: ImageData,
  srcW: number,
  srcH: number,
  scoreThresh: number,
  phoneScoreThresh: number,
  iouThresh: number,
): Promise<{ boxes: DetectionBox[]; phoneCandidates: DetectionBox[]; maxPhoneScore: number }> {
  if (!session) {
    throw new Error("Object detection model is not initialized");
  }
  const [tensorData, padX, padY] = preprocess(imageData, srcW, srcH);
  const input = new Tensor("float32", tensorData, [1, 3, MODEL_SIZE, MODEL_SIZE]);
  const inputName = session.inputNames[0];
  const { output0 } = await session.run({ [inputName]: input }) as { output0: Tensor };

  // YOLOv8 output: [1, 84, 8400] or [1, num_det, 6] depending on export
  const data = output0.data as Float32Array;
  const [, rows, cols] = output0.dims; // [1, 84, 8400]
  const results: DetectionBox[] = [];
  const phoneCandidates: DetectionBox[] = [];
  let maxPhoneScore = 0;

  function decodeBox(ci: number, score: number): DetectionBox {
    const cx = data[ci];
    const cy = data[cols + ci];
    const bw = data[2 * cols + ci];
    const bh = data[3 * cols + ci];

    return {
      label: "cell phone",
      score,
      x: ((cx - bw / 2) - padX) / (MODEL_SIZE - 2 * padX),
      y: ((cy - bh / 2) - padY) / (MODEL_SIZE - 2 * padY),
      width: bw / (MODEL_SIZE - 2 * padX),
      height: bh / (MODEL_SIZE - 2 * padY),
    };
  }

  // YOLOv8n standard export: shape [1, 84, 8400]
  // Each col: [cx, cy, w, h, cls0…cls79]
  for (let ci = 0; ci < cols; ci++) {
    const phoneScore = rows > 4 + PHONE_CLASS_INDEX
      ? data[(4 + PHONE_CLASS_INDEX) * cols + ci]
      : 0;
    maxPhoneScore = Math.max(maxPhoneScore, phoneScore);
    if (phoneScore >= PHONE_DEBUG_MIN_SCORE) {
      phoneCandidates.push(decodeBox(ci, phoneScore));
    }

    let maxConf = 0;
    let clsIdx = -1;
    for (let r = 4; r < rows; r++) {
      const conf = data[r * cols + ci];
      if (conf > maxConf) { maxConf = conf; clsIdx = r - 4; }
    }
    if (clsIdx < 0) continue;
    const label = COCO_LABELS[clsIdx] ?? `cls${clsIdx}`;
    if (!FLAGGED_LABELS.has(label)) continue;
    const minScore = label === "cell phone" ? phoneScoreThresh : scoreThresh;
    if (maxConf < minScore) continue;

    results.push(label === "cell phone"
      ? decodeBox(ci, maxConf)
      : {
          ...decodeBox(ci, maxConf),
          label,
        });
  }

  return {
    boxes: nms(results, iouThresh),
    phoneCandidates: nms(phoneCandidates, iouThresh).slice(0, 5),
    maxPhoneScore,
  };
}

// ── Message handler ──────────────────────────────────────────────────────────
self.onmessage = async (e: MessageEvent) => {
  const {
    type,
    imageData,
    width,
    height,
    scoreThresh = 0.45,
    phoneScoreThresh = scoreThresh,
    iouThresh = 0.45,
  } = e.data as {
    type: string;
    imageData: ImageData;
    width: number;
    height: number;
    scoreThresh?: number;
    phoneScoreThresh?: number;
    iouThresh?: number;
  };

  if (type === "init") {
    self.postMessage({ type: "loading" });
      console.debug('[yolo.worker] loading started');
    try {
      await loadModel();
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (type === "detect") {
    try {
      const { boxes, phoneCandidates, maxPhoneScore } = await detect(
        imageData,
        width,
        height,
        scoreThresh,
        phoneScoreThresh,
        iouThresh,
      );
      self.postMessage({ type: "result", boxes, phoneCandidates, maxPhoneScore });
    } catch (error) {
      self.postMessage({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
};
