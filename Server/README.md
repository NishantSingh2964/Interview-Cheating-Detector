# Server

## AutoProctor integration

The candidate must explicitly consent before the frontend loads the AutoProctor SDK. The server issues the AutoProctor client ID, the interview session ID as `testAttemptId`, and a Base64 HMAC-SHA256 signature. `AUTOPROCTOR_CLIENT_SECRET` is never returned to the browser. The SDK starts before interview questions become available and is stopped when the interview ends.

Configure these values in `Server/.env` and in the backend deployment's environment:

```env
AUTOPROCTOR_CLIENT_ID=your_autoproctor_client_id
AUTOPROCTOR_CLIENT_SECRET=your_autoproctor_client_secret
```

Keep both values server-side and out of source control. The current integration enables AutoProctor's face-count, audio, tab-switch, and multiple-screen checks. To match the working sample, forced fullscreen, random photos, auxiliary-device monitoring, full-session recording, and the SDK's copy/paste blocker are disabled. The website itself blocks and logs right-click and copy/paste attempts. After monitoring stops, the candidate page asks the SDK to render its report; evidence images, audio, and URLs remain with AutoProctor and its developer dashboard. Events stored by this application contain only event codes, labels, and server timestamps. Treat these events as review signals, not proof of misconduct.

### Deploying the backend to Vercel

Configure the backend project with `Server` as its Root Directory. Add `AUTOPROCTOR_CLIENT_ID` and `AUTOPROCTOR_CLIENT_SECRET` to the backend's Production environment and redeploy after changing them. Do not add these secrets to the frontend project.

For production, set `CLIENT_URLS` to a comma-separated list of exact frontend origins, or `CLIENT_URL` for a single origin. To allow this project's Vercel branch previews, set `VERCEL_PREVIEW_PROJECT` and `VERCEL_PREVIEW_TEAM` to the Vercel project and team slugs. The server allows only HTTPS preview hosts matching that project and team; keep any additional origins in `CLIENT_URLS`.

## Spoken and typed answer review

At the start of an interview, candidates choose writing or speaking mode and are asked once whether to consent to answer processing. Writing-mode candidates may decline and continue, but answers are not saved for AI review in that case. Speaking mode requires consent because recordings are sent to the configured Whisper service for transcription. With consent, the answer or transcript is sent to the configured provider for an experimental estimate and saved for the interviewer for up to 7 days; raw answer audio is not retained. Copying from and pasting into the interview page are blocked and recorded as review signals. Paste-event metadata and answer entry method are not sent to the model provider and do not identify the text's source.

Install Python 3.9 or later. From `Server`, create and activate a virtual environment and install the transcription dependencies:

```powershell
python -m venv transcription\.venv
.\transcription\.venv\Scripts\Activate.ps1
python -m pip install -r transcription\requirements.txt
```

For local development, install the transcription dependencies and start the Whisper service:

```powershell
npm run transcription
```

The default `base.en` model is downloaded on first use and runs on CPU. Keep the service running. In `Server\.env`, configure OpenRouter:

```env
ANSWER_REVIEW_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=provider/model:free
```

Create a key in [OpenRouter settings](https://openrouter.ai/settings/keys) and choose a currently available free model from the [OpenRouter free models list](https://openrouter.ai/models?max_price=0). Use its exact model ID, including `:free` when that suffix is shown. Free model availability, rate limits, and account requirements vary; this is not unlimited usage. Keep the key in the server `.env`, never in frontend code or source control. OpenRouter is the default provider. To continue using Ollama instead, set `ANSWER_REVIEW_PROVIDER=ollama`, `OLLAMA_API_KEY`, and `OLLAMA_MODEL`. Then start the Node server from `Server`:

```powershell
npm run dev
```

Start the frontend as usual. Candidates choose their response mode and answer-processing consent once before starting. In writing mode, clicking Next (or Submit interview on the final question) saves and queues the answer only when consent was given; in speaking mode, the recording is sent to the configured Whisper service and its transcript is queued with consent. The candidate waits only for the queue acknowledgment, not for the model. A MongoDB-backed worker scores jobs in the background. Answers under 40 words are saved as "Not scored" without calling the provider. Temporary rate-limit, timeout, network, and provider-server errors are retried up to five times with `Retry-After` or exponential backoff; permanent request/configuration errors fail immediately. The admin page shows Queued, Processing, Retrying, Completed score bands, or Failed, and refreshes queue status while a session is open. Failed jobs can be manually retried by an admin.

For longer answers, the provider returns an experimental 0-100 AI-likeness estimate based only on the question and answer text. The admin view groups scores into 0-39 "Low AI-likeness estimate," 40-69 "Inconclusive estimate," and 70-100 "High AI-likeness estimate." These are arbitrary experiment bands over a subjective, uncalibrated model opinion—not measured probabilities, confidence levels, or proof of authorship. They must not be used alone to judge a candidate. The configured provider receives the answer text when analysis is requested.

### Deploying Whisper as a second Vercel project

The Node backend cannot reach `127.0.0.1:8001` on a developer's computer from Vercel. Keep the existing Node backend and frontend projects, and deploy this FastAPI app as a **separate Vercel project** from the same Git repository:

1. In Vercel, choose **Add New → Project** and import this repository again.
2. Set **Root Directory** to `Server/transcription` (enable **Include files outside the root directory** only if Vercel asks; this app does not import files outside its root).
3. Let Vercel detect the Python/FastAPI app. The root contains `app.py`, `requirements.txt`, `.python-version`, and `vercel.json`; no Docker setup is needed.
4. In the new Whisper project's **Settings → Environment Variables**, add `WHISPER_API_KEY` with a long random secret. Generate one locally, for example with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Do not send the value in chat or commit it. Redeploy this project after saving the variable.
5. After deployment, open `https://<whisper-project>.vercel.app/health` and confirm it returns JSON with `"status":"ok"`. This is the Whisper project's URL.
6. In the **existing Node backend project** on Vercel, add `WHISPER_URL` with that base URL (no `/transcribe` suffix) and `WHISPER_API_KEY` with the exact same secret. Redeploy the Node backend.
7. Check the Whisper project's `/health` response. It should report `"model":"base.en"` and `"bundled":true`, then test a spoken answer.

The Whisper function rejects transcription requests if its Vercel `WHISPER_API_KEY` is missing, and audio is limited to 4 MB to fit within Vercel's function request limits. The Vercel build downloads the configured model (`base.en` by default, or `tiny.en`) into the function bundle, avoiding a model download to the function's limited temporary `/tmp` storage at request time. To fit Vercel's 500 MB Python function limit, the build hook removes the unused `onnxruntime` package and Silero VAD model from the Vercel build environment; VAD filtering is disabled on Vercel, but remains enabled for local development. This can make silence handling less robust. The transcription requirements pin PyAV below version 19 because `faster-whisper` calls an audio-decoding option removed in PyAV 19. The function uses CPU and may have cold starts. Locally, recordings can be up to 25 MB; on Vercel they are limited to 4 MB to stay below the function request-size limit. `base.en` is more accurate than `tiny.en` in many cases but uses more package space and compute. Keep the key only in the two Vercel project environments, never in the frontend or Git.

Answer text and scores expire after 7 days. The admin view may show "Paste event observed" when the browser reports a paste event. This is browser metadata only: it does not identify the text source or establish who wrote it, and it is not sent to the model. The AI-likeness estimate is not a reliable authorship detector; use it only in controlled testing against known-source answers and track false positives as well as misses. The score should not be treated as proof or an automatic penalty. The admin dashboard currently has no authentication; do not expose this project publicly with real candidate data until access controls are in place.

## Inactive session cleanup

Sessions with no recorded heartbeat for 60 seconds are marked `ended` with reason `heartbeat_timeout`; this is not counted as a proctoring violation. The server checks on startup, periodically, and when a connected session's inactivity timer expires. Newly created sessions are not treated as abandoned until their first candidate socket connects and records a heartbeat.
