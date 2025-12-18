# Agent Guidelines for `videoaudio`

Scope: Repository root and all subdirectories.

## Working Mode
- This project is a specification-first effort for a local, scriptable video+audio pipeline. Keep outputs concise and avoid full executable code, workflow JSON dumps, or large class definitions. Favor structured descriptions, interfaces, and pseudocode only.
- Tests are not required at this stage; do not introduce or run automated tests unless explicitly requested by future instructions.
- Any documentation updates must be reflected in both this `AGENTS.md` and the repository `README.md`.
- VIDAX HTTP API and security notes live in `docs/VIDAX_API.md` and `docs/SECURITY.md`; keep these in sync when touching runner behavior or auth.
- Output must be Markdown-only; avoid non-Markdown payloads.
- Do not include code snippets longer than 30 lines in any response.
- The specification is normative; `README.md` is only an entry point and must stay concise.
- All open decisions must be captured in `docs/OPEN_DECISIONS.md`.

## Style & Content
- Use deterministic terminology: surface required parameters (fps, seed, resolution, target_frames) and emphasize audio-driven timing.
- When describing flows, prefer bullet lists or tables over long prose. Cite defaults and validation rules clearly.
- Keep scope lean: focus on job specification, orchestration steps, and integration touchpoints (ComfyUI REST, LipSync CLI, ffmpeg mux). Avoid embedding actual workflow graphs.
- Run manifests now separate `run_status` (queued/running/completed/failed) from `exit_status` (success/failed/partial/null).
- VIDAX must manage ComfyUI lifecycle (health/start) before comfyui runner phase; surface endpoints in VIDAX docs accordingly.

## Commit & PR
- Ensure each change is committed on the current branch and accompanied by a PR message via `make_pr` after committing.
- Summaries should mention specs added or updated.
