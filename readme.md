# VideoAudio Pipeline Specification

Specification-first plan for a local, scriptable video+audio pipeline that produces a `final.mp4` aligned to an audio master. No executable code is included yet—only structure, parameters, and validation rules.

## Repository Layout (planned)
- `pipelines/video_sync/` — orchestration logic and CLI wrappers.
- `config/` — defaults and schema definitions for job files.
- `workflows/` — ComfyUI workflow references (IDs only, no graphs).
- `jobs/` — per-run inputs/outputs and reports.
- `docs/` — Markdown reports and specs.
- `src/` — orchestrator, clients, wrappers.

## Job File Specification (`job.json`)
- **Modes**
  - Mode A: `start_image` + `audio` + `motion_prompt` → extended/generative video.
  - Mode B: `start_video` + `audio` + `motion_prompt` → extend/adapt existing clip.
- **Determinism**: `seed`, `fps`, `resolution`, `model/workflow IDs`, and `target_frames` are explicit. `target_frames = round(audio_seconds * fps)`.
- **Audio master rule**: Audio duration defines video length. If incoming video exceeds audio, trim or regenerate respecting `audio_master=true`. If shorter, extend/generate to match `target_frames`.

### Schema (types, defaults, validation)
- `mode` (string, required): `"A"` or `"B"`.
- `audio` (path, required): existing `.wav`; validated for readability and duration > 0.
- `start_image` (path, required for A): existing `.png`/`.jpg`; ignored in B.
- `start_video` (path, required for B): existing `.mp4`; ignored in A.
- `end_image` (path, optional): `.png`/`.jpg`; used for transitions when `transition.enabled=true`.
- `motion_prompt` (string, required): concise movement/style description; must be non-empty.
- `fps` (int, required, default 25): 1–60; used for `target_frames`.
- `resolution` (object, required): `{ "width": int, "height": int }`; both even, min 256, max 4096.
- `seed` (int, required): 0–2^31-1; reused across modules for reproducibility.
- `output` (path, required): directory or file prefix for `final.mp4` and `report.md`; parent must exist or be creatable.
- `debug` (bool, default false): enables extra artifacts in `workdir`.
- `workdir` (path, default `jobs/<timestamp>`): workspace for intermediates (`extended.mp4`, `lipsynced.mp4`, `report.md`).
- `comfy` (object, required): `{ base_url (string, required), workflow_id_A (string, required for Mode A), workflow_id_B (string, required for Mode B), workflow_id_stabilize (string, optional) }`.
- `lipsync` (object, required): `{ provider (string, e.g., "wav2lip"), params (object, optional) }`.
- `render` (object, optional): `{ crf (int, default 18, range 0–51), preset (string, default "medium"), pix_fmt (string, default "yuv420p") }`.
- `timing` (object, optional): `{ enabled (bool, default false), provider (string, e.g., "whisperx"), timing_json (path, optional override) }`; if enabled, forced alignment must yield valid segment timings.
- `transition` (object, optional): `{ enabled (bool, default false), end_blend_sec (float, default 1.0, >=0), strength_curve (string, default "linear") }`; requires `end_image` when enabled.

### Derived values and checks
- `audio_seconds`: measured from `audio` via metadata; must be >0.
- `target_frames`: computed once per job using `round(audio_seconds * fps)`; stored in report and passed to ComfyUI.
- `fps mismatch`: If source video FPS differs from job `fps`, resample source to `fps` before processing.
- `resolution alignment`: Enforce even dimensions; up/down-scale inputs to requested resolution.
- `audio_master` enforcement: Video operations (extend/generate/trim) are driven by `target_frames`. Tolerance ≤ 1 frame.

## ComfyUI Parameter Mapping (conceptual)
- Inputs to workflows include: `target_frames`, `fps`, `seed`, `motion_prompt`, `start_image`/`start_video`, optional `end_image`, resolution fields, and `timing`-derived weights if enabled.
- Mode A uses `workflow_id_A`; Mode B uses `workflow_id_B`; stabilization uses `workflow_id_stabilize` when requested.
- REST call: submit prompt JSON to ComfyUI `/prompt` endpoint with node inputs populated per mode. Retries on timeout with clear failure reporting.

## LipSync Wrapper (outline)
- CLI call pattern after generation: `lipsync_cli --video extended.mp4 --audio audio.wav --out lipsynced.mp4 [provider-specific params]`.
- Constraints: prefer frontal faces; keep `fps` consistent; cap resolution per provider limits; fail fast with diagnostic if sync confidence is low.

## Orchestrator Flow (high level)
1. Parse `job.json`, validate schema/defaults, resolve paths, compute `audio_seconds` and `target_frames`.
2. Normalize inputs (fps, resolution) and prepare `workdir`.
3. Call ComfyUI workflow (mode-specific) to produce `extended.mp4` matching `target_frames`.
4. Optional stabilization pass using `workflow_id_stabilize`.
5. Run LipSync on `extended.mp4` + `audio.wav` → `lipsynced.mp4`.
6. Mux/encode with ffmpeg using `render` settings → `final.mp4`.
7. Emit `report.md` with timings, parameters, and artifact paths.

## Report Content (per run)
- Input summary (paths, mode, fps, resolution, seed, target_frames).
- Audio/video durations and any resampling/resolution changes.
- Workflow IDs and lip-sync provider used.
- Artifact paths (`extended.mp4`, `lipsynced.mp4`, `final.mp4`, optional `timing.json`).
- Warnings/failures and suggested debug steps.

