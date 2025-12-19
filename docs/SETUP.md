# Setup & Install Flow

- **StateDir**: Default `~/.va/state` for assets/configs (override base via `VA_STATE_DIR`). Layout created by `va install` → `comfyui/workflows/`, `comfyui/models/`, `config/`, `runs/`.
- **Config Copy**: Missing configs are cloned from `config/*.example.json` into `VA_STATE_DIR/state/config/vidax.json`, `lipsync.providers.json`, and `assets.json` (override path via `VIDAX_ASSETS_CONFIG`). Paths starting with `~/` are expanded when VIDAX loads config.
- **Config Resolution**: VIDAX reads config from `VIDAX_CONFIG` or `VA_STATE_DIR/state/config/vidax.json`, falling back to `config/vidax.json`. Assets manifest resolves via `VIDAX_ASSETS_CONFIG` → `VA_STATE_DIR/state/config/assets.json` → `config/assets.json`.
- **Doctor**: `va doctor` checks `ffmpeg`, `ffprobe`, `node` (Python is a non-critical warning). Missing critical tools exit with code 20 (`UNSUPPORTED_FORMAT` mapping); ok exit is 0.
- **Install**: `va install` runs Doctor (unless `--skip-doctor`), ensures StateDir layout, copies configs into `state/config`, and installs/verifies assets from the manifest (SHA-256 enforced, `on_missing=download`, `on_hash_mismatch=fail`, `allow_insecure_http=false`, `unpack` uses `unzip`). Failure to install or verify assets surfaces `UNSUPPORTED_FORMAT` for download/hash issues or `OUTPUT_WRITE_FAILED` for write/unzip problems.
- **ComfyUI Paths**: If `comfyui.paths.workflows_dir` / `models_dir` are set in `vidax.json`, VIDAX exports them as environment variables for ComfyUI. Defaults fall back to the StateDir paths above (workflows/models under `state/`).
- **Server Integration**: `POST /install` triggers the same asset install routine; `GET /install/status` reports missing or mismatched assets without downloading.
- **Retry Notes**: `unzip` is required to unpack assets with `unpack=true`; if unavailable, installation fails with `OUTPUT_WRITE_FAILED`.
