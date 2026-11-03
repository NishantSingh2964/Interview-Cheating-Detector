import type { ViolationType } from "@/lib/types";

export const VIOLATION_LABELS: Record<ViolationType, string> = {
  no_face: "No face",
  multiple_faces: "Multiple faces",
  looking_away: "Looking away",
  object_detected: "Object",
  multiple_persons: "Multiple people",
  window: "Tab or focus",
  fullscreen: "Fullscreen",
  copy: "Copy",
  paste: "Paste",
  contextmenu: "Right-click",
  sound: "Sound",
  heartbeat_lost: "Heartbeat lost",
};
