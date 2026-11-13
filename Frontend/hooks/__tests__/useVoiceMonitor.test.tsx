// Automated test for useVoiceMonitor – simulates candidate voice then a different voice
// Run with `npm test` (jest) after ensuring dev dependencies are installed.

import { renderHook, act } from "@testing-library/react-hooks";
import { useVoiceMonitor } from "../useVoiceMonitor";
import { DETECT } from "@/lib/config";

// Simple RMS generator – returns a constant value per call
function createRmsGenerator(values: number[]) {
  let idx = 0;
  return () => {
    const v = values[idx] ?? values[values.length - 1];
    idx = Math.min(idx + 1, values.length - 1);
    return v;
  };
}

// Mock AudioContext & related nodes
class MockAnalyserNode {
  public fftSize = 1024;
  public frequencyBinCount = this.fftSize / 2;
  private getData: () => number;
  constructor(getData: () => number) {
    this.getData = getData;
  }
  getFloatTimeDomainData(_arr: Float32Array) {
    // Fill array with a dummy waveform whose RMS equals the generated value
    const rms = this.getData();
    // Simple sine‑wave approximation
    for (let i = 0; i < _.length; i++) {
      _.[i] = Math.sin((i / _.length) * Math.PI * 2) * rms;
    }
  }
}

class MockAudioContext {
  private analyser: MockAnalyserNode;
  constructor(getRms: () => number) {
    this.analyser = new MockAnalyserNode(getRms);
  }
  createAnalyser() {
    return this.analyser as unknown as AnalyserNode;
  }
  createMediaStreamSource(_stream: MediaStream) {
    return {
      connect: () => {},
      disconnect: () => {},
    } as unknown as MediaStreamAudioSourceNode;
  }
  close() {}
}

// Mock getUserMedia to resolve with a dummy MediaStream
Object.defineProperty(navigator, "mediaDevices", {
  value: {
    getUserMedia: jest.fn().mockResolvedValue(new MediaStream()),
  },
  writable: true,
});

// Replace global AudioContext with our mock – we will swap RMS generators during the test
let rmsGenerator = createRmsGenerator([]);
(global as any).AudioContext = class extends MockAudioContext {
  constructor() {
    super(() => rmsGenerator());
    super();
  }
};

describe("useVoiceMonitor – voice differentiation", () => {
  jest.useFakeTimers();

  it("should emit candidate_voice then other_voice", async () => {
    const onViolation = jest.fn();

    // First 3 seconds of reference – use a stable RMS of 0.5
    const referenceRms = Array(30).fill(0.5); // CHUNK_MS = 100ms => 30 chunks = 3s
    // Live monitoring – start with same RMS (candidate), then switch to 0.1 (different)
    const liveRms = referenceRms.concat(Array(20).fill(0.2)); // lower similarity
    // Create generator that yields the sequence above
    rmsGenerator = createRmsGenerator(referenceRms.concat(liveRms));

    // Render the hook – enabled = true
    const { result, waitForNextUpdate } = renderHook(() =>
      useVoiceMonitor(null, true, onViolation),
    );

    // Fast‑forward reference capture (≈3 s)
    act(() => {
      jest.advanceTimersByTime(3_000);
    });

    // Fast‑forward live monitoring to hit both candidate and other voice sections
    act(() => {
      jest.advanceTimersByTime(2_000);
    });

    // Allow pending effects to settle
    await waitForNextUpdate?.();

    // Verify calls – first should be candidate_voice, later other_voice
    const callTypes = onViolation.mock.calls.map((c) => c[0].type);
    expect(callTypes).toContain("candidate_voice");
    expect(callTypes).toContain("other_voice");
  });
});
