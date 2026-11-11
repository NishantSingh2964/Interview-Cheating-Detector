import os
from pathlib import Path

os.environ["HF_HUB_DISABLE_XET"] = "1"

from huggingface_hub import snapshot_download

MODEL_NAME = os.getenv("WHISPER_MODEL", "base.en")
SUPPORTED_MODELS = {"tiny.en", "base.en"}
MODEL_DIR = Path(__file__).resolve().parent / "models" / MODEL_NAME


def main() -> None:
    if MODEL_NAME not in SUPPORTED_MODELS:
        raise ValueError(
            f"Unsupported WHISPER_MODEL {MODEL_NAME!r}; choose one of "
            f"{', '.join(sorted(SUPPORTED_MODELS))}."
        )

    if (MODEL_DIR / "model.bin").is_file():
        print(f"Whisper model {MODEL_NAME} is already bundled.")
        return

    print(f"Downloading Whisper model {MODEL_NAME} for the Vercel function bundle.")
    snapshot_download(
        repo_id=f"Systran/faster-whisper-{MODEL_NAME}",
        local_dir=MODEL_DIR,
        allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"],
    )
    if not (MODEL_DIR / "model.bin").is_file():
        raise FileNotFoundError(f"Whisper model download did not create {MODEL_DIR / 'model.bin'}.")
    print(f"Whisper model {MODEL_NAME} is ready for bundling.")


if __name__ == "__main__":
    main()
