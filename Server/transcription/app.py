import hmac
import logging
import os
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from starlette.concurrency import run_in_threadpool

IS_VERCEL = os.getenv("VERCEL") == "1"
if IS_VERCEL:
    os.environ.setdefault("HF_HOME", "/tmp/huggingface")
    os.environ["HF_HUB_DISABLE_XET"] = "1"

from faster_whisper import WhisperModel

MAX_AUDIO_BYTES = 4 * 1024 * 1024 if IS_VERCEL else 25 * 1024 * 1024
MODEL_NAME = os.getenv("WHISPER_MODEL", "base.en")
MODEL_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
MODEL_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_API_KEY = os.getenv("WHISPER_API_KEY")

FILE_SUFFIXES = {
    "audio/webm": ".webm",
    "audio/mp4": ".mp4",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/mpeg": ".mp3",
}

app = FastAPI(docs_url=None, redoc_url=None)
logger = logging.getLogger(__name__)
model = None
model_lock = threading.Lock()


def transcribe_file(filename: str) -> str:
    global model
    with model_lock:
        if model is None:
            model = WhisperModel(
                MODEL_NAME,
                device=MODEL_DEVICE,
                compute_type=MODEL_COMPUTE_TYPE,
            )
        segments, _ = model.transcribe(
            filename,
            beam_size=5,
            vad_filter=True,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/transcribe")
async def transcribe(request: Request):
    if IS_VERCEL and not WHISPER_API_KEY:
        raise HTTPException(status_code=503, detail="Whisper service authentication is not configured.")

    if WHISPER_API_KEY:
        expected = f"Bearer {WHISPER_API_KEY}"
        provided = request.headers.get("authorization", "")
        if not hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
            raise HTTPException(status_code=401, detail="Invalid transcription service credentials.")

    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    suffix = FILE_SUFFIXES.get(content_type)
    if suffix is None:
        raise HTTPException(status_code=415, detail="Unsupported audio format.")

    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="Audio data is empty.")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio exceeds the 25 MB limit.")

    filename = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as audio_file:
            audio_file.write(audio)
            filename = audio_file.name
        transcript = await run_in_threadpool(transcribe_file, filename)
        return {"text": transcript}
    except Exception as error:
        logger.exception("[whisper] transcription failed")
        raise HTTPException(status_code=500, detail="Whisper could not transcribe this recording.") from error
    finally:
        if filename is not None:
            Path(filename).unlink(missing_ok=True)
