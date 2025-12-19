# Setup & Install Flow

- **StateDir**: Default `~/.va` (override `VA_STATE_DIR`). Layout created by `va install` → `comfyui/workflows/`, `comfyui/models/`, `runs/`.
- **Config Copy**: Missing configs are cloned from `config/*.example.json` to `config/vidax.json`, `config/lipsync.providers.json`, and `config/assets.json` (override path via `VIDAX_ASSETS_CONFIG`). Paths starting with `~/` are expanded when VIDAX loads config.
- **Doctor**: `va doctor` checks `ffmpeg`, `ffprobe`, `node` (Python is a non-critical warning). Missing critical tools raise `VALIDATION_ERROR` and non-zero exit.
- **Install**: `va install` runs Doctor (unless `--skip-doctor`), ensures StateDir layout, copies configs, and installs/verifies assets from the manifest (SHA-256 enforced, `on_missing=download`, `on_hash_mismatch=fail`). Failure to install or verify assets surfaces `VALIDATION_ERROR`.
- **ComfyUI Paths**: If `comfyui.paths.workflows_dir` / `models_dir` are set in `vidax.json`, VIDAX exports them as environment variables for ComfyUI. Defaults fall back to the StateDir paths above.
- **Server Integration**: `POST /install` triggers the same asset install routine; `GET /install/status` reports missing or mismatched assets without downloading.
- **Retry Notes**: `unzip` is required to unpack assets with `unpack=true`; if unavailable, installation fails with `OUTPUT_WRITE_FAILED`.
