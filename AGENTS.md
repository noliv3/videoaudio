# Agent Guidelines for `videoaudio`

Scope: Repository root and all subdirectories.

## Working Mode
- Specification-first, but docs must reflect actual code; reconcile discrepancies and record them instead of introducing theoretical behavior.
- Feedback ohne Dateiinhalte: Responses stay Markdown-only and must not paste file bodies.
- Outputs must stay Markdown-only, concise, and free of file contents; avoid workflow dumps or class-sized code. No code snippets longer than 30 lines.
- Tests are out of scope; do not add or run automated tests unless explicitly requested.
- Any documentation changes must be mirrored in both this `AGENTS.md` and `README.md`. Capture unresolved or diverging points in `docs/OPEN_DECISIONS.md` (or equivalent compliance notes) when touched.
- ComfyUI phase is blocking submit → poll (`poll_interval_ms` default 500, `timeout_total` respected) → collect to `workdir/comfyui/output.mp4` or `workdir/frames/`; manifest stores `workflow_id`, `prompt_id`, `output_kind`, `output_paths`, plus `chunk_size`/`chunk_count`. ComfyUI ist im Produktionspfad Pflicht (default enable), Health-Check vor Submit, Ausfall → `COMFYUI_UNAVAILABLE` (kein Dummy-Skip). Fehlt `workflow_id` bei aktivem ComfyUI, wird der Run mit `COMFYUI_UNAVAILABLE` abgebrochen.
- Runner enforces resume/overwrite rules, measures audio via `ffprobe`, and performs a real ffmpeg encode (CFR at `determinism.fps`, audio padded for buffer intervals, frame-hold for post, dummy video from start image/frame if needed) mit Scaling auf die abgeleitete Render-Auflösung und optionalem Endbild-Hold bei `end_image` + Post-Puffer.
- LipSync executes when `lipsync.enable=true` and a provider exists (provider Pflicht bei aktivem LipSync; default off), config is loaded from `VA_STATE_DIR/state/config/lipsync.providers.json` (or `state_dir` in `vidax.json`), falling back to repo `config/lipsync.providers.json`; output at `workdir/lipsync/output.mp4`. `allow_passthrough=true` keeps encode alive on provider errors and must be noted in manifest/summary.
- Buffer: `pre_seconds` und `post_seconds` erweitern `visual_target_duration_seconds` und ComfyUI `target_frames`; Audio-Padding + Frame-Hold setzen den Mux-Horizont auf `audio + pre + post`. Endbild-Hold nutzt den Post-Puffer, wenn vorhanden.
- Prepare records SHA-256 hashes for start/audio/end inputs (or `INPUT_NOT_FOUND`), probes start resolution via ffprobe, clamps it to mod2 `max_width`/`max_height` (default 854x480) and resolves ComfyUI seeds per `seed_policy` (fixed/random), generating missing seeds within `0..4294967295`, storing them in manifest/effective_params, and passing the final seed to ComfyUI.
- Setup/Installer: `va doctor` checks `ffmpeg`/`ffprobe`/`node` (Python warning only) and exits 20 when ffmpeg/ffprobe fehlen; `va install` copies missing configs (`vidax.json`, `lipsync.providers.json`, `assets.json`) into `VA_STATE_DIR/state/config` (default base `~/.va/state`), ensures `state/comfyui/workflows` + `state/comfyui/models` + bundled sources under `state/assets/workflows`, and downloads/verifies assets via manifest resolution `VIDAX_ASSETS_CONFIG` → `VA_STATE_DIR/state/config/assets.json` → `config/assets.json` (SHA-256 enforced, `on_missing=download`, `on_hash_mismatch=fail`, `allow_insecure_http=false`, `unzip` required for `unpack=true`, hash errors → `UNSUPPORTED_FORMAT`, relative/file URLs resolve against the manifest directory). Default asset set ships `assets/workflows/vidax_text2img_frames.json` with real hash into `state/comfyui/workflows/`.
- Default workflow handling: `va produce` sets `workflow_ids=["vidax_text2img_frames"]`; `va run` keeps `workflow_ids` as provided (empty + comfy enabled → Fehler). The ComfyUI payload is always an inline Text2Img graph (CheckpointLoaderSimple → CLIPTextEncode pos/neg → EmptyLatentImage → KSampler → VAEDecode → SaveImage) mit Chunking (default 4 Frames pro Prompt, Seed pro Offset). Render-Auflösung kommt aus Start-Probe, geklemmt auf `max_width`/`max_height`. Missing assets block auto-start only when workflows are requested.
- ComfyUI lifecycle defaults: health checks hit `/system_stats` (fallback `/health`), start defaults to `python main.py --listen 127.0.0.1 --port 8188` with CWD from config; on Windows `command="python"` prefers `<cwd>/venv/Scripts/python.exe` before the global `python`.
- Buffer-Pfade: `pre_seconds` und `post_seconds` sind aktiv; Audio wird für Buffer mit Stille gepaddet und Video hält letzte Frames für den Post-Puffer. Manifest führt `audio_input_duration_seconds`, `audio_duration_seconds`, `visual_target_duration_seconds` und `target_frames` basierend auf der gepaddeten Timeline.
- Default Workflow: Inline SDXL Text2Img Batch wie oben beschrieben, `frame_count=target_frames`, Default-Auflösung 1024x576, Prompt/Negative aus `comfyui.params.*`; Output sind PNG-Frames (Modell `sd_xl_base_1.0.safetensors` erforderlich). Asset-Datei bleibt als Referenz vorhanden, der API-Graph kommt aus dem Code.
- Asset-Handling: Laufende ComfyUI-Instanzen mit `ok`-Health werden nicht durch fehlende Assets blockiert; Auto-Start erfordert gültige Manifest-Assets.
- Produce-Oberfläche: `va produce`/`POST /produce` bauen Job + Workdir (default `./workdir/run-<ts>` CLI bzw. `~/.va/state/runs/<run_id>` API), setzen `final_name=fertig.mp4` und starten den Run sofort.

## Style & Content
- Use deterministic terminology (fps, seed, resolution, target_frames) and emphasize audio-driven timing and trim rules.
- Prefer bullet lists or tables for flows; surface defaults, validation, and output locations clearly.
- Keep scope lean: focus on job spec, orchestration, ComfyUI REST, LipSync CLI, ffmpeg mux. Avoid workflow graphs.
- Manifest wording separates `run_status` (queued/running/completed/failed) from `exit_status` (success/failed/partial/null).
- VIDAX must manage ComfyUI lifecycle (health/start) before the comfyui runner phase; keep `docs/VIDAX_API.md` and `docs/SECURITY.md` aligned with actual runner/auth behavior.

## Commit & PR
- Commit changes on the current branch and call `make_pr` with a PR message after committing.
- Summaries should highlight which specs or docs were added or updated.
