"use client";

import { useEffect, useRef } from "react";
import { DETECT } from "@/lib/config";
import { createSignalGate } from "@/lib/signalGate";
import type { ViolationReport } from "@/lib/types";

type Emit = (event: Pick<ViolationReport, "type" | "reason" | "confidence">) => void;

export function useWindowMonitor(enabled: boolean, onViolation: Emit) {
  const onViolationRef = useRef(onViolation);

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    if (!enabled) return;

    const gates = {
      window: createSignalGate(0, DETECT.cooldownMs),
      fullscreen: createSignalGate(0, DETECT.cooldownMs),
      contextmenu: createSignalGate(0, DETECT.cooldownMs),
    };
    let sawFullscreen = Boolean(document.fullscreenElement);

    const emit = (
      type: keyof typeof gates,
      reason: string,
    ) => {
      if (!gates[type].update(true, Date.now())) return;
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
        return;
      }
      if (sawFullscreen) emit("fullscreen", "Exited fullscreen");
    };
    const onContext = (event: MouseEvent) => {
      event.preventDefault();
      emit("contextmenu", "Right-click blocked");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("contextmenu", onContext);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("contextmenu", onContext);
    };
  }, [enabled]);
}
