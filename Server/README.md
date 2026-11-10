# Server

## Voice enrollment model

Voice enrollment needs the English CAM++ speaker-embedding model in `Server/models/`. From this directory, run:

```powershell
npm install
npm run setup-voice-model
npm run dev
```

The model is downloaded separately and ignored by Git; the server returns `503` from enrollment if it is missing. Production deployments must also provide the model file and a runtime compatible with `sherpa-onnx-node`'s native binaries. Deployment packaging has not been validated yet.

Enrollment requires explicit candidate consent. The server processes the submitted clips in memory and stores only a session voiceprint; ending the interview clears the voiceprint and consent metadata. Raw audio clips are not persisted.

## Live speaker comparison

The browser sends VAD speech segments (3–15 seconds) only for enrolled sessions. The server computes each embedding and compares it with the session voiceprint. When at least two of the last three scores are below the configured similarity threshold, it records an `other_voice` review signal and applies a 10-second cooldown. Audio is processed in memory and not persisted; the short comparison window is also kept only in server memory.

Live comparison is **off by default**. Do not set `VOICE_OTHER_THRESHOLD` until you have calibrated a threshold against consented recordings for the chosen model, microphones, and expected room conditions. Set it in the server environment to a cosine similarity from `-1` to `1`; lower scores than that value are treated as a mismatch. The current code intentionally does not choose a default threshold. The camera panel reports when comparison is unavailable.

`other_voice` is stored and shown in the candidate/admin event logs as an amber review signal. It does not increment the disciplinary violation count or trigger warnings/termination. It is not proof of identity and should be reviewed by a person. Speaker comparison without diarization can miss overlapping speakers and may flag legitimate voice or acoustic changes. Validate it with real, consented recordings before relying on it.

## Inactive session cleanup

Sessions with no recorded heartbeat for 60 seconds are marked `ended` with reason `heartbeat_timeout`; this is not counted as a proctoring violation. The server checks on startup, periodically, and when a connected session's inactivity timer expires. Session-only voiceprint and consent metadata are cleared at the same time. Newly created sessions are not treated as abandoned until their first candidate socket connects and records a heartbeat.

## Calibrating with local recordings

The calibration command runs entirely on the local server machine; it does not upload, save, or modify audio. Use WAV clips from consenting speakers and split one candidate's recordings into separate reference and held-out candidate sets. Include several other consenting speakers in the held-out `other` set, with varied but realistic microphones and room conditions. Do not reuse reference clips as test clips.

Supported input is mono or stereo PCM16/Float32 WAV, 3–15 seconds per file; other sample rates are resampled locally to 16 kHz. From `Server`, run:

```powershell
npm run calibrate-voice -- --reference .\voice-tests\reference --candidate .\voice-tests\candidate --other .\voice-tests\other
```

The command reports per-clip cosine scores and the false-alarm/miss tradeoff at each observed threshold. Review the results with a sufficiently varied dataset and select a threshold deliberately; the command never picks or persists one. Only then set `VOICE_OTHER_THRESHOLD` in the server environment and repeat testing with recordings not used to select it.
