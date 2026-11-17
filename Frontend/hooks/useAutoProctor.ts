"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAutoProctorInstance,
  loadAutoProctorSdk,
  waitForMonitoringStarted,
  waitForMonitoringStopped,
  AUTOPROCTOR_EVIDENCE_LABELS,
  type AutoProctorInstance,
  type AutoProctorSignal,
} from "@/lib/autoProctor";
import { getAutoProctorCredentials, reportAutoProctorEvent } from "@/lib/api";

const MAX_AUTO_PROCTOR_SIGNALS = 500;

export type AutoProctorStatus = "idle" | "preparing" | "ready" | "starting" | "active" | "stopping" | "completed";

interface UseAutoProctorOptions {
  onUnexpectedStop?: () => void;
}

export function useAutoProctor({ onUnexpectedStop }: UseAutoProctorOptions = {}) {
  const [status, setStatus] = useState<AutoProctorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [signals, setSignals] = useState<AutoProctorSignal[]>([]);
  const instanceRef = useRef<AutoProctorInstance | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const evidenceListenerRef = useRef<((event: Event) => void) | null>(null);
  const unexpectedStopListenerRef = useRef<(() => void) | null>(null);
  const onUnexpectedStopRef = useRef(onUnexpectedStop);
  const hasStartedRef = useRef(false);
  const hasStoppedRef = useRef(false);
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const reportPromiseRef = useRef<Promise<void> | null>(null);
  const reportShownRef = useRef(false);

  useEffect(() => {
    onUnexpectedStopRef.current = onUnexpectedStop;
  }, [onUnexpectedStop]);

  const prepare = useCallback(async (sessionId: string) => {
    if (instanceRef.current) return;
    setStatus("preparing");
    setError(null);
    setSignals([]);
    sessionIdRef.current = sessionId;
    try {
      const credentials = await getAutoProctorCredentials(sessionId);
      await loadAutoProctorSdk();
      const instance = createAutoProctorInstance(credentials);
      await instance.setup({
        trackingOptions: {
          audio: true,
          numHumans: true,
          tabSwitch: true,
          photosAtRandom: false,
          detectMultipleScreens: true,
          forceFullScreen: false,
          auxiliaryDevice: false,
          recordSession: false,
        },
        showHowToVideo: false,
      });
      instanceRef.current = instance;
      setStatus("ready");
    } catch (prepareError) {
      setStatus("idle");
      setError(
        prepareError instanceof Error
          ? prepareError.message
          : "Could not prepare AutoProctor.",
      );
      throw prepareError;
    }
  }, []);

  const start = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance || hasStartedRef.current) {
      throw new Error("AutoProctor is not ready to start.");
    }

    setError(null);
    setStatus("starting");
    const started = waitForMonitoringStarted();
    const onEvidence = (event: Event) => {
      const detail = (event as CustomEvent<{ evidenceCode?: unknown }>).detail;
      const evidenceCode = detail?.evidenceCode;
      const id = sessionIdRef.current;
      if (!id || typeof evidenceCode !== "number" || !Number.isInteger(evidenceCode)) return;
      const label = AUTOPROCTOR_EVIDENCE_LABELS[evidenceCode];
      setSignals((current) => [
        {
          evidenceCode,
          label: label ?? `AutoProctor event ${evidenceCode}`,
          occurredAt: new Date().toISOString(),
        },
        ...current,
      ].slice(0, MAX_AUTO_PROCTOR_SIGNALS));
      if (!label) {
        console.warn(`[autoproctor] unrecognized evidence code ${evidenceCode}`);
        return;
      }
      void reportAutoProctorEvent(id, evidenceCode).catch((eventError) => {
        console.warn("[autoproctor] could not save an event:", eventError);
      });
    };
    const onUnexpectedStop = () => {
      if (stopPromiseRef.current) return;
      hasStoppedRef.current = true;
      if (evidenceListenerRef.current) {
        window.removeEventListener("apEvidenceEvent", evidenceListenerRef.current);
        evidenceListenerRef.current = null;
      }
      if (unexpectedStopListenerRef.current) {
        window.removeEventListener("apMonitoringStopped", unexpectedStopListenerRef.current);
        unexpectedStopListenerRef.current = null;
      }
      setStatus("completed");
      setError("AutoProctor stopped monitoring unexpectedly.");
      onUnexpectedStopRef.current?.();
    };
    window.addEventListener("apEvidenceEvent", onEvidence);
    window.addEventListener("apMonitoringStopped", onUnexpectedStop);
    evidenceListenerRef.current = onEvidence;
    unexpectedStopListenerRef.current = onUnexpectedStop;
    try {
      instance.start();
      hasStartedRef.current = true;
    } catch (startError) {
      started.cancel();
      window.removeEventListener("apEvidenceEvent", onEvidence);
      window.removeEventListener("apMonitoringStopped", onUnexpectedStop);
      evidenceListenerRef.current = null;
      unexpectedStopListenerRef.current = null;
      setStatus("ready");
      throw startError;
    }

    return started.promise.then(() => {
      setStatus("active");
    }).catch((startError: unknown) => {
      hasStartedRef.current = false;
      if (evidenceListenerRef.current) {
        window.removeEventListener("apEvidenceEvent", evidenceListenerRef.current);
        evidenceListenerRef.current = null;
      }
      if (unexpectedStopListenerRef.current) {
        window.removeEventListener("apMonitoringStopped", unexpectedStopListenerRef.current);
        unexpectedStopListenerRef.current = null;
      }
      hasStartedRef.current = false;
      setStatus("ready");
      setError(
        startError instanceof Error
          ? startError.message
          : "AutoProctor could not start.",
      );
      throw startError;
    });
  }, []);

  const stop = useCallback(async () => {
    const instance = instanceRef.current;
    if (!instance || !hasStartedRef.current || hasStoppedRef.current) return;
    if (stopPromiseRef.current) return stopPromiseRef.current;

    setStatus("stopping");
    const stopped = waitForMonitoringStopped();
    stopPromiseRef.current = stopped.promise.then(() => {
      hasStoppedRef.current = true;
      if (evidenceListenerRef.current) {
        window.removeEventListener("apEvidenceEvent", evidenceListenerRef.current);
        evidenceListenerRef.current = null;
      }
      if (unexpectedStopListenerRef.current) {
        window.removeEventListener("apMonitoringStopped", unexpectedStopListenerRef.current);
        unexpectedStopListenerRef.current = null;
      }
      setStatus("completed");
    }).catch((stopError: unknown) => {
      setError(
        stopError instanceof Error
          ? stopError.message
          : "AutoProctor did not confirm that monitoring stopped.",
      );
      throw stopError;
    });

    try {
      instance.stop();
    } catch (stopError) {
      stopped.cancel();
      stopPromiseRef.current = null;
      throw stopError;
    }
    return stopPromiseRef.current;
  }, []);

  const showReport = useCallback(() => {
    const instance = instanceRef.current;
    if (!instance || !hasStoppedRef.current || reportShownRef.current) return Promise.resolve();
    if (reportPromiseRef.current) return reportPromiseRef.current;

    setReportLoading(true);
    setReportError(null);
    reportPromiseRef.current = instance.showReport({ groupReportsIntoTabs: true })
      .then(() => {
        reportShownRef.current = true;
      })
      .catch((reportFailure: unknown) => {
        const message = reportFailure instanceof Error
          ? reportFailure.message
          : "AutoProctor could not load its report.";
        setReportError(message);
        throw reportFailure;
      })
      .finally(() => {
        setReportLoading(false);
        reportPromiseRef.current = null;
      });
    return reportPromiseRef.current;
  }, []);

  useEffect(() => () => {
    if (evidenceListenerRef.current) {
      window.removeEventListener("apEvidenceEvent", evidenceListenerRef.current);
      evidenceListenerRef.current = null;
    }
    if (unexpectedStopListenerRef.current) {
      window.removeEventListener("apMonitoringStopped", unexpectedStopListenerRef.current);
      unexpectedStopListenerRef.current = null;
    }
    if (hasStartedRef.current && !hasStoppedRef.current) {
      try {
        instanceRef.current?.stop();
      } catch (stopError) {
        console.error("[autoproctor] failed to stop during page cleanup:", stopError);
      }
    } else if (instanceRef.current && !hasStartedRef.current) {
      try {
        instanceRef.current.destroy?.();
      } catch (destroyError) {
        console.error("[autoproctor] failed to destroy during page cleanup:", destroyError);
      }
    }
  }, []);

  return { status, error, reportError, reportLoading, signals, prepare, start, stop, showReport };
}
