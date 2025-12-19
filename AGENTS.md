# Agent Guidelines for `videoaudio`

Scope: Repository root and all subdirectories.

## Working Mode
- Specification-first, but docs must reflect actual code; reconcile discrepancies and record them instead of introducing theoretical behavior.
- Feedback ohne Dateiinhalte: Responses stay Markdown-only and must not paste file bodies.
- Outputs must stay Markdown-only, concise, and free of file contents; avoid workflow dumps or class-sized code. No code snippets longer than 30 lines.
- Tests are out of scope; do not add or run automated tests unless explicitly requested.
- Any documentation changes must be mirrored in both this `AGENTS.md` and `README.md`. Capture unresolved or diverging points in `docs/OPEN_DECISIONS.md` (or equivalent compliance notes) when touched.
- ComfyUI phase is blocking submit → poll (`poll_interval_ms` default 500, `timeout_total` respected) → collect to `workdir/comfyui/output.mp4` or `workdir/frames/`; manifest stores `workflow_id`, `prompt_id`, `output_kind`, `output_paths`.
- Runner enforces resume/overwrite rules, measures audio via `ffprobe`, and performs a real ffmpeg encode (CFR at `determinism.fps`, video duration capped to audio, dummy video from start image/frame if needed).
- LipSync executes when `lipsync.enable=true` and a provider exists in `config/lipsync.providers.json`; output at `workdir/lipsync/output.mp4`. `allow_passthrough=true` keeps encode alive on provider errors and must be noted in manifest/summary.
- Buffer: `pre_seconds` extends `visual_target_duration_seconds` and ComfyUI `target_frames`; audio remains the mux horizon and `post_seconds` currently fails validation (no audio padding).
- Prepare records SHA-256 hashes for start/audio/end inputs (or `INPUT_NOT_FOUND`) and resolves ComfyUI seeds per `seed_policy` (fixed/random/per_retry), generating missing seeds within `0..4294967295`, storing them in manifest/effective_params, and passing the final seed to ComfyUI.

## Style & Content
- Use deterministic terminology (fps, seed, resolution, target_frames) and emphasize audio-driven timing and trim rules.
- Prefer bullet lists or tables for flows; surface defaults, validation, and output locations clearly.
- Keep scope lean: focus on job spec, orchestration, ComfyUI REST, LipSync CLI, ffmpeg mux. Avoid workflow graphs.
- Manifest wording separates `run_status` (queued/running/completed/failed) from `exit_status` (success/failed/partial/null).
- VIDAX must manage ComfyUI lifecycle (health/start) before the comfyui runner phase; keep `docs/VIDAX_API.md` and `docs/SECURITY.md` aligned with actual runner/auth behavior.

## Commit & PR
- Commit changes on the current branch and call `make_pr` with a PR message after committing.
- Summaries should highlight which specs or docs were added or updated.
