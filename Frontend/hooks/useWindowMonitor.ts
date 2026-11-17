"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { ViolationReport, ViolationType } from "@/lib/types";

type BrowserViolation = Pick<ViolationReport, "type" | "reason" | "confidence">;
type Emit = (event: BrowserViolation) => void;

const EVENT_COOLDOWN_MS = 1500;

export function useWindowMonitor(armed: boolean, active: boolean, onViolation: Emit) {
  const activeRef = useRef(active);
  const onViolationRef = useRef(onViolation);

  useLayoutEffect(() => {
    activeRef.current = active;
    onViolationRef.current = onViolation;
  }, [active, onViolation]);

  useEffect(() => {
    if (!armed) return;

    const lastReportedAt = new Map<ViolationType, number>();
    let sawFullscreen = Boolean(document.fullscreenElement);

    const emit = (type: ViolationType, reason: string) => {
      if (!activeRef.current) return;
      const now = Date.now();
      if (now - (lastReportedAt.get(type) ?? 0) < EVENT_COOLDOWN_MS) return;
      lastReportedAt.set(type, now);
      onViolationRef.current({ type, reason, confidence: 1 });
    };

    const onVisibility = () => {
      if (document.hidden) emit("window", "Switched away from the interview tab");
    };
    const onBlur = () => {
      if (!document.hidden) emit("window", "Interview window lost focus");
    };
    const onFullscreen = () => {
      if (document.fullscreenElement) {
        sawFullscreen = true;
      } else if (sawFullscreen) {
        emit("fullscreen", "Exited fullscreen");
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!activeRef.current) return;
      event.preventDefault();
      emit("contextmenu", "Right-click blocked");
    };
    const onClipboard = (event: ClipboardEvent) => {
      if (!activeRef.current) return;
      event.preventDefault();
      emit(event.type === "copy" ? "copy" : "paste", `${event.type === "copy" ? "Copy" : "Paste"} blocked`);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!activeRef.current || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "v" && key !== "x") return;
      event.preventDefault();
      emit(key === "v" ? "paste" : "copy", `${key === "v" ? "Paste" : "Copy"} shortcut blocked`);
    };

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("blur", onBlur);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("copy", onClipboard, true);
    window.addEventListener("paste", onClipboard, true);
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("copy", onClipboard, true);
      window.removeEventListener("paste", onClipboard, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [armed]);
}
