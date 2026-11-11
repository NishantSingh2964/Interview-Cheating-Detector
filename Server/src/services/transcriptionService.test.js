const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WHISPER_URL = "https://whisper.example.test/";
process.env.WHISPER_API_KEY = "test-whisper-key";

const { transcribeAudio } = require("./transcriptionService");

test("sends audio to the configured hosted Whisper service with authorization", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  let requestUrl;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(JSON.stringify({ text: "recognized speech" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const transcript = await transcribeAudio(Buffer.from("audio"), "audio/webm");

  assert.equal(requestUrl, "https://whisper.example.test/transcribe");
  assert.equal(requestOptions.headers.Authorization, "Bearer test-whisper-key");
  assert.equal(requestOptions.headers["Content-Type"], "audio/webm");
  assert.equal(transcript, "recognized speech");
});

test("preserves hosted Whisper service-unavailable status", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });
  global.fetch = async () => new Response(
    JSON.stringify({ detail: "Transcription service is starting." }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );

  await assert.rejects(
    transcribeAudio(Buffer.from("audio"), "audio/webm"),
    (error) => error.statusCode === 503 && error.message === "Transcription service is starting.",
  );
});
