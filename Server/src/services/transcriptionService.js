const WHISPER_URL = (process.env.WHISPER_URL || "http://127.0.0.1:8001").replace(/\/+$/, "");
const WHISPER_API_KEY = process.env.WHISPER_API_KEY;
const REMOTE_WHISPER_CONFIGURED = Boolean(process.env.WHISPER_URL);

async function transcribeAudio(audio, contentType) {
  if (REMOTE_WHISPER_CONFIGURED && !WHISPER_API_KEY) {
    const configurationError = new Error("WHISPER_API_KEY must be configured when using a hosted Whisper service.");
    configurationError.statusCode = 503;
    throw configurationError;
  }

  let response;
  try {
    response = await fetch(`${WHISPER_URL}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        ...(WHISPER_API_KEY ? { Authorization: `Bearer ${WHISPER_API_KEY}` } : {}),
      },
      body: audio,
      signal: AbortSignal.timeout(180000),
    });
  } catch (error) {
    const unavailable = new Error("The configured Whisper service is unavailable.");
    unavailable.statusCode = ["TimeoutError", "AbortError"].includes(error.name) ? 504 : 503;
    throw unavailable;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const failure = new Error(body.detail || "The configured Whisper service could not transcribe this recording.");
    failure.statusCode = [413, 503, 504].includes(response.status) ? response.status : 502;
    throw failure;
  }

  const result = await response.json();
  if (!result || typeof result.text !== "string") {
    throw new Error("The configured Whisper service returned an invalid transcript.");
  }
  return result.text;
}

module.exports = { transcribeAudio };
