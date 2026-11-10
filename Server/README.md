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

## Spoken and typed answer review

At the start of an interview, candidates choose writing or speaking mode and are asked once whether to consent to answer processing. Writing-mode candidates may decline and continue, but answers are not saved for AI review in that case. Speaking mode requires consent because recordings are sent to the local Whisper service for transcription. With consent, the answer or transcript is sent to the configured provider for an experimental estimate and saved for the interviewer for up to 7 days; raw answer audio is not saved. Copy and paste are enabled for testing and do not create proctoring violations. Paste-event metadata and answer entry method are not sent to the model provider and do not identify the text's source.

Install Python 3.9 or later. From `Server`, create and activate a virtual environment and install the transcription dependencies:

```powershell
python -m venv transcription\.venv
.\transcription\.venv\Scripts\Activate.ps1
python -m pip install -r transcription\requirements.txt
```

In the first PowerShell window, start the local Whisper service:

```powershell
npm run transcription
```

The default `base.en` model is downloaded on first use and runs locally on CPU. Keep the service running. In `Server\.env`, configure OpenRouter:

```env
ANSWER_REVIEW_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=provider/model:free
```

Create a key in [OpenRouter settings](https://openrouter.ai/settings/keys) and choose a currently available free model from the [OpenRouter free models list](https://openrouter.ai/models?max_price=0). Use its exact model ID, including `:free` when that suffix is shown. Free model availability, rate limits, and account requirements vary; this is not unlimited usage. Keep the key in the server `.env`, never in frontend code or source control. OpenRouter is the default provider. To continue using Ollama instead, set `ANSWER_REVIEW_PROVIDER=ollama`, `OLLAMA_API_KEY`, and `OLLAMA_MODEL`. Then start the Node server from `Server`:

```powershell
npm run dev
```

Start the frontend as usual. Candidates choose their response mode and answer-processing consent once before starting. In writing mode, clicking Next (or Submit interview on the final question) saves and queues the answer only when consent was given; in speaking mode, the recording is transcribed locally and the transcript is queued with consent. The candidate waits only for the queue acknowledgment, not for the model. A MongoDB-backed worker scores jobs in the background. Answers under 40 words are saved as "Not scored" without calling the provider. Temporary rate-limit, timeout, network, and provider-server errors are retried up to five times with `Retry-After` or exponential backoff; permanent request/configuration errors fail immediately. The admin page shows Queued, Processing, Retrying, Completed score bands, or Failed, and refreshes queue status while a session is open. Failed jobs can be manually retried by an admin.

For longer answers, the provider returns an experimental 0-100 AI-likeness estimate based only on the question and answer text. The admin view groups scores into 0-39 "Low AI-likeness estimate," 40-69 "Inconclusive estimate," and 70-100 "High AI-likeness estimate." These are arbitrary experiment bands over a subjective, uncalibrated model opinion—not measured probabilities, confidence levels, or proof of authorship. They must not be used alone to judge a candidate. The configured provider receives the answer text when analysis is requested.

Answer text and scores expire after 7 days. The admin view may show "Paste event observed" when the browser reports a paste event. This is browser metadata only: it does not identify the text source or establish who wrote it, and it is not sent to the model. The AI-likeness estimate is not a reliable authorship detector; use it only in controlled testing against known-source answers and track false positives as well as misses. The score should not be treated as proof or an automatic penalty. The admin dashboard currently has no authentication; do not expose this project publicly with real candidate data until access controls are in place.

## Live speaker comparison

Speaking mode starts the existing voice enrollment flow. Candidates give separate, explicit consent before creating a session-only voice reference; they can skip enrollment and still use speaking mode for answer transcription. Live speaker comparison runs only for an enrolled speaking-mode session. The voice enrollment model and threshold requirements below still apply.

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
