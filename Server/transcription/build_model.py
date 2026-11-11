import os
import shutil
import sysconfig
from pathlib import Path

os.environ["HF_HUB_DISABLE_XET"] = "1"

from huggingface_hub import snapshot_download

MODEL_NAME = os.getenv("WHISPER_MODEL", "base.en")
SUPPORTED_MODELS = {"tiny.en", "base.en"}
MODEL_DIR = Path(__file__).resolve().parent / "models" / MODEL_NAME


def remove_vercel_vad_runtime() -> None:
    if os.getenv("VERCEL") != "1":
        return

    site_packages = Path(sysconfig.get_paths()["purelib"]).resolve()
    if not (site_packages / "faster_whisper").is_dir():
        raise FileNotFoundError(f"Could not locate faster-whisper in {site_packages}.")

    targets = [
        site_packages / "onnxruntime",
        *site_packages.glob("onnxruntime-*.dist-info"),
        site_packages / "faster_whisper" / "assets" / "silero_vad_v6.onnx",
    ]
    removed = []
    removed_bytes = 0
    for target in targets:
        if not target.exists():
            continue
        removed_bytes += (
            sum(path.stat().st_size for path in target.rglob("*") if path.is_file())
            if target.is_dir()
            else target.stat().st_size
        )
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        removed.append(target.name)

    if (site_packages / "onnxruntime").exists():
        raise RuntimeError("ONNX Runtime is still present in the Vercel build environment.")
    size_mib = removed_bytes / (1024 * 1024)
    print(
        f"Removed Vercel-only unused VAD files: {', '.join(removed) or 'none found'} "
        f"({size_mib:.1f} MiB)."
    )


def main() -> None:
    if MODEL_NAME not in SUPPORTED_MODELS:
        raise ValueError(
            f"Unsupported WHISPER_MODEL {MODEL_NAME!r}; choose one of "
            f"{', '.join(sorted(SUPPORTED_MODELS))}."
        )

    if (MODEL_DIR / "model.bin").is_file():
        print(f"Whisper model {MODEL_NAME} is already bundled.")
    else:
        print(f"Downloading Whisper model {MODEL_NAME} for the Vercel function bundle.")
        snapshot_download(
            repo_id=f"Systran/faster-whisper-{MODEL_NAME}",
            local_dir=MODEL_DIR,
            allow_patterns=["config.json", "model.bin", "tokenizer.json", "vocabulary.txt"],
        )
        if not (MODEL_DIR / "model.bin").is_file():
            raise FileNotFoundError(f"Whisper model download did not create {MODEL_DIR / 'model.bin'}.")
        print(f"Whisper model {MODEL_NAME} is ready for bundling.")

    remove_vercel_vad_runtime()


if __name__ == "__main__":
    main()
