"use client";

import { useEffect, useRef, useState } from "react";

export type VoiceActivityStatus = "idle" | "loading" | "ready" | "unavailable";
type SpeechEndHandler = (samples: Float32Array) => void;

export function useVoiceActivity(
  stream: MediaStream | null,
  enabled: boolean,
  onSpeechEnd?: SpeechEndHandler,
) {
  const [status, setStatus] = useState<VoiceActivityStatus>("idle");
  const [speaking, setSpeaking] = useState(false);
  const onSpeechEndRef = useRef(onSpeechEnd);

  useEffect(() => {
    onSpeechEndRef.current = onSpeechEnd;
  }, [onSpeechEnd]);

  useEffect(() => {
    if (!enabled || !stream?.getAudioTracks().length) {
      return;
    }

    let stopped = false;
    let vad: { start: () => void; pause: () => void } | null = null;

    void import("@ricky0123/vad-web")
      .then(({ MicVAD }) => {
        if (!stopped) setStatus("loading");
        return MicVAD.new({
          getStream: async () => stream,
          pauseStream: async () => {},
          resumeStream: async () => stream,
          model: "v5",
          minSpeechMs: 3000,
          baseAssetPath: "/vad/",
          onnxWASMBasePath: "/ort/",
          onSpeechStart: () => {
            if (!stopped) setSpeaking(true);
          },
          onSpeechEnd: (samples: Float32Array) => {
            if (!stopped) {
              setSpeaking(false);
              onSpeechEndRef.current?.(samples);
            }
          },
        });
      })
      .then((instance) => {
        vad = instance;
        if (stopped) {
          vad.pause();
          return;
        }
        setStatus("ready");
        vad.start();
      })
      .catch((error: unknown) => {
        if (stopped) return;
        console.error("[voice-activity] detector failed to load:", error);
        setStatus("unavailable");
        setSpeaking(false);
      });

    return () => {
      stopped = true;
      vad?.pause();
    };
  }, [enabled, stream]);

  const hasAudio = enabled && Boolean(stream?.getAudioTracks().length);
  return {
    status: hasAudio ? status : "idle",
    speaking: hasAudio && speaking,
  };
}
