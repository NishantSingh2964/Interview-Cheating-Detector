const WHISPER_URL = "http://127.0.0.1:8001";

async function transcribeAudio(audio, contentType) {
  let response;
  try {
    response = await fetch(`${WHISPER_URL}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: audio,
      signal: AbortSignal.timeout(180000),
    });
  } catch (error) {
    const unavailable = new Error("The local Whisper service is unavailable.");
    unavailable.statusCode = error.name === "TimeoutError" ? 504 : 503;
    throw unavailable;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const failure = new Error(body.detail || "The local Whisper service could not transcribe this recording.");
    failure.statusCode = response.status === 413 ? 413 : 502;
    throw failure;
  }

  const result = await response.json();
  if (!result || typeof result.text !== "string") {
    throw new Error("The local Whisper service returned an invalid transcript.");
  }
  return result.text;
}

module.exports = { transcribeAudio };
