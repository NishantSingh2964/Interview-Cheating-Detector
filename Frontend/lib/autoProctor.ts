"use client";

export const AUTOPROCTOR_CONSENT_VERSION = "autoproctor-proctoring-v1";

export const AUTOPROCTOR_EVIDENCE_LABELS: Record<number, string> = {
  5001: "No face detected",
  5002: "Multiple people detected",
  5003: "Random photo captured",
  5004: "Elevated audio detected",
  5005: "Interview tab lost focus",
  5006: "Interview tab regained focus",
  5007: "Multiple monitors detected",
  5008: "Multiple monitors suspected",
  5009: "Exited full screen",
  5010: "Audio monitoring started",
  5011: "Auxiliary device video uploaded",
  5012: "Object detected",
  5013: "Monitor connected after initial check",
  5014: "Multiple monitors blocked at start",
  5015: "Multiple monitor check bypassed",
};

export interface AutoProctorSignal {
  evidenceCode: number;
  label: string;
  occurredAt: string;
}

export interface AutoProctorCredentials {
  clientId: string;
  testAttemptId: string;
  hashedTestAttemptId: string;
}

export interface AutoProctorInstance {
  setup(options: {
    trackingOptions: {
      audio: boolean;
      numHumans: boolean;
      tabSwitch: boolean;
      photosAtRandom: boolean;
      detectMultipleScreens: boolean;
      forceFullScreen: boolean;
      auxiliaryDevice: boolean;
      recordSession: boolean;
      disableCopyPaste?: boolean;
    };
    showHowToVideo: boolean;
    testContainerId?: string;
  }): Promise<void>;
  start(): void;
  stop(): void;
  showReport(options?: {
    groupReportsIntoTabs?: boolean;
    userDetails?: { name?: string; email?: string } | null;
  }): Promise<void>;
  destroy?(): void;
}

declare global {
  interface Window {
    AutoProctor?: new (credentials: AutoProctorCredentials) => AutoProctorInstance;
  }
}

const SCRIPT_ID = "autoproctor-sdk";
const SCRIPT_URL = "https://cdn.autoproctor.co/ap-entry.js";
const SDK_READY_TIMEOUT_MS = 30_000;
let scriptPromise: Promise<void> | null = null;

export function loadAutoProctorSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("AutoProctor can only be loaded in a browser."));
  }
  if (window.AutoProctor) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    let settled = false;
    const cleanup = () => {
      window.removeEventListener("apLibReady", onReady);
      window.removeEventListener("apLibLoadingFailed", onLoadingFailed);
      script.removeEventListener("error", onScriptError);
      clearTimeout(timeout);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onReady = () => {
      finish(() => {
        if (window.AutoProctor) resolve();
        else reject(new Error("AutoProctor signaled ready without exposing its browser API."));
      });
    };
    const onLoadingFailed = () => {
      script.remove();
      finish(() => reject(new Error("AutoProctor could not finish loading its browser SDK.")));
    };
    const onScriptError = () => {
      script.remove();
      finish(() => reject(new Error("Could not load the AutoProctor SDK loader.")));
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("Timed out waiting for the AutoProctor SDK to become ready.")));
    }, SDK_READY_TIMEOUT_MS);

    window.addEventListener("apLibReady", onReady, { once: true });
    window.addEventListener("apLibLoadingFailed", onLoadingFailed, { once: true });
    script.addEventListener("error", onScriptError, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

function waitForAutoProctorEvent<T extends Event>(
  eventName: string,
  timeoutMs: number,
  rejectionEventName?: string,
) {
  let cancel = () => {};
  const promise = new Promise<T>((resolve, reject) => {
    const finish = (callback: () => void) => {
      window.removeEventListener(eventName, onSuccess);
      if (rejectionEventName) window.removeEventListener(rejectionEventName, onError);
      clearTimeout(timeout);
      callback();
    };
    const onSuccess = (event: Event) => finish(() => resolve(event as T));
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ errorCode?: number; code?: number }>).detail;
      const code = detail?.errorCode ?? detail?.code;
      finish(() => reject(new Error(
        code ? `AutoProctor could not start (error ${code}).` : "AutoProctor could not start. Check browser and device permissions.",
      )));
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("AutoProctor did not confirm that monitoring started in time.")));
    }, timeoutMs);

    cancel = () => finish(() => reject(new Error("AutoProctor startup was cancelled.")));
    window.addEventListener(eventName, onSuccess, { once: true });
    if (rejectionEventName) window.addEventListener(rejectionEventName, onError, { once: true });
  });

  return { promise, cancel: () => cancel() };
}

export function createAutoProctorInstance(credentials: AutoProctorCredentials) {
  const AutoProctor = window.AutoProctor;
  if (!AutoProctor) throw new Error("The AutoProctor SDK is not ready.");
  return new AutoProctor(credentials);
}

export function waitForMonitoringStarted() {
  return waitForAutoProctorEvent("apMonitoringStarted", 120_000, "apErrorEvent");
}

export function waitForMonitoringStopped() {
  return waitForAutoProctorEvent("apMonitoringStopped", 30_000);
}
