# VideoAudio Runner (Ist-Stand)

Skriptbarer Video+Audio-Runner: Job laden, validieren, optional über VIDAX starten und zu `final.mp4` encodieren. Dokumentation ist normativ, folgt aber dem aktuellen Codezustand.

## Requirements
- Node.js Runtime
- ffmpeg und ffprobe im PATH

## Quickstart (CLI)
1. `node src/main.js validate path/to/job.json`
2. `node src/main.js run path/to/job.json --workdir /abs/workdir`

## Features
### Implemented (Code)
- CLI-Kommandos `validate`, `run`, `status`, `logs` mit Exit-Codes aus `src/errors.js`; `run` kennt `--workdir` und `--resume`.
- Manifest + Registry: Runs werden unter `~/.va/runs.json` registriert; `manifest.json` hält `run_status`/`exit_status`, Phasen, Seeds, Audio/FPS/Target-Frames.
- Prepare: Audio-Dauer via `ffprobe`, FPS/Target-Frames nach `determinism.fps` und Rounding; Input-Pfade und Seeds werden protokolliert.
- ComfyUI: Nur wenn `comfyui.workflow_ids[0]` gesetzt und Client verfügbar → `submit → wait (poll_interval_ms default 500) → collect` nach `workdir/comfyui/output.mp4` oder `workdir/frames/`; sonst Phase `skipped`.
- LipSync: Läuft nur bei `lipsync.enable` (default true) **und** vorhandenem Provider in `config/lipsync.providers.json`; Output `workdir/lipsync/output.mp4`; `allow_passthrough=true` erlaubt Encode trotz Fehler.
- Encode: Reales ffmpeg-Muxing (CFR auf `determinism.fps`) mit Audio als Master, Trim auf Audiolänge, Dummy-Video aus Startbild/-frame falls keine ComfyUI-Frames/Videos.
- Overwrite/Resume: `final.mp4` blockiert neuen Lauf ohne `--resume`; Resume verlangt existierendes Manifest und fehlendes Final.
- Logging: `logs/events.jsonl` mit Zeitstempel + Stage/Level; CLI `logs` streamt diese Datei.
- VIDAX API: `GET /health`, `GET /comfyui/health`, `POST /comfyui/start`, `POST /jobs`, `POST /jobs/:id/start`, `GET /jobs/:id`, `/manifest`, `/logs`; API-Key Pflicht über `X-API-Key`, Bind default `127.0.0.1`.

### Planned / Not in Code
- Buffering/Timing-Objekte, Motion-Stärkeregler, Timing-Files aus den Specs werden nicht validiert oder angewendet.
- Retry-/Backoff-Policy für ComfyUI, Stabilize-Phase, Seed-Policies jenseits fester Seeds, sowie Seed-Generierung fehlen.
- Manifest-Erweiterungen wie `visual_target_duration_seconds` mit Buffer, `buffer_applied` Inhalte, `runner.log` Alternative und Cleanup-Regeln sind nicht implementiert.
- VIDAX-Fehlercodes für spezifische Startfehler (z.B. `COMFYUI_START_FAILED`) und API-gesteuerte Partial/Resume-Semantik sind nicht vorhanden.

## Docs (Entry Points)
- [`docs/JOB_SCHEMA.md`](docs/JOB_SCHEMA.md)
- [`docs/OUTPUT_CONTRACT.md`](docs/OUTPUT_CONTRACT.md)
- [`docs/COMFYUI_INTERFACE.md`](docs/COMFYUI_INTERFACE.md)
- [`docs/LIPSYNC_INTERFACE.md`](docs/LIPSYNC_INTERFACE.md)
- [`docs/VIDAX_API.md`](docs/VIDAX_API.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md)
