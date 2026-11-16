const {
  DetectFacesCommand,
  DetectLabelsCommand,
  RekognitionClient,
} = require("@aws-sdk/client-rekognition");

const MAX_FRAME_BYTES = 1024 * 1024;
const MIN_LABEL_CONFIDENCE = 70;
const PREFLIGHT_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAANElEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfgx1lAABqFDyOQAAAABJRU5ErkJggg==",
  "base64",
);
const FLAGGED_LABELS = new Map([
  ["cell phone", "cell phone"],
  ["mobile phone", "cell phone"],
  ["smartphone", "cell phone"],
  ["phone", "cell phone"],
  ["mobile device", "cell phone"],
  ["laptop", "laptop"],
  ["television", "tv"],
  ["tv", "tv"],
  ["keyboard", "keyboard"],
  ["mouse", "mouse"],
  ["remote control", "remote"],
  ["book", "book"],
  ["person", "person"],
]);
let client;

function validateFrame(imageBytes) {
  if (!Buffer.isBuffer(imageBytes) || imageBytes.length === 0) {
    const error = new Error("A valid image is required.");
    error.statusCode = 400;
    throw error;
  }
  if (imageBytes.length > MAX_FRAME_BYTES) {
    const error = new Error("The image must be no larger than 1 MB.");
    error.statusCode = 413;
    throw error;
  }
}

function getRegion() {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
}

function isRekognitionConfigured() {
  return Boolean(getRegion());
}

function getClient() {
  const region = getRegion();
  if (!region) {
    const error = new Error("AWS_REGION must be configured to use Amazon Rekognition.");
    error.statusCode = 503;
    throw error;
  }
  if (!client) client = new RekognitionClient({ region });
  return client;
}

async function detectFaceCount(imageBytes, rekognitionClient) {
  validateFrame(imageBytes);

  const result = await (rekognitionClient || getClient()).send(
    new DetectFacesCommand({
      Image: { Bytes: imageBytes },
      Attributes: ["DEFAULT"],
    }),
  );
  return Array.isArray(result.FaceDetails) ? result.FaceDetails.length : 0;
}

async function detectObjects(imageBytes, rekognitionClient) {
  validateFrame(imageBytes);

  const result = await (rekognitionClient || getClient()).send(
    new DetectLabelsCommand({
      Image: { Bytes: imageBytes },
      MinConfidence: MIN_LABEL_CONFIDENCE,
    }),
  );
  const objects = [];
  for (const detectedLabel of result.Labels ?? []) {
    const label = FLAGGED_LABELS.get(detectedLabel.Name?.toLowerCase());
    if (!label) continue;

    for (const instance of detectedLabel.Instances ?? []) {
      if (!instance) continue;
      const bounds = instance.BoundingBox;
      const score = (instance.Confidence ?? detectedLabel.Confidence ?? 0) / 100;
      if (!bounds || !Number.isFinite(score) || score < MIN_LABEL_CONFIDENCE / 100) continue;
      objects.push({
        label,
        score,
        x: bounds.Left ?? 0,
        y: bounds.Top ?? 0,
        width: bounds.Width ?? 0,
        height: bounds.Height ?? 0,
      });
    }
  }
  return objects;
}

async function verifyRekognitionAccess(rekognitionClient) {
  await Promise.all([
    detectFaceCount(PREFLIGHT_IMAGE, rekognitionClient),
    detectObjects(PREFLIGHT_IMAGE, rekognitionClient),
  ]);
}

module.exports = {
  detectFaceCount,
  detectObjects,
  isRekognitionConfigured,
  verifyRekognitionAccess,
};
