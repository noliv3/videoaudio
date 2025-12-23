# VideoAudio Runner (Ist-Stand)

Skriptbarer Video+Audio-Runner: Job laden, validieren, optional über VIDAX starten und zu `final.mp4` encodieren. Dokumentation ist normativ, folgt aber dem aktuellen Codezustand.

## Requirements
- Node.js Runtime
- ffmpeg und ffprobe im PATH

## Quickstart (CLI)
1. `node src/main.js doctor` prüft ffmpeg/ffprobe/node (Exit 20 wenn ffmpeg/ffprobe fehlen).
2. `node src/main.js install` legt StateDir + Configs an und zieht Assets gemäß Assets-Manifest (Auflösung: `VIDAX_ASSETS_CONFIG` → `VA_STATE_DIR/state/config/assets.json` → `config/assets.json`; StateDir via `VA_STATE_DIR`, default `~/.va/state`).
3. `node src/main.js produce --audio <A> --start <img|vid> --prompt \"...\" [--neg \"...\"] [--pre/post ...] [--width/height ...] [--max_width/max_height ...] [--lipsync on|off --lipsync_provider <id>] [--comfyui_chunk_size N] [--no-comfyui] [--workdir ...]` baut ein Job-JSON und startet den Run (Final-Basename `fertig.mp4`). Default: ComfyUI an, Lipsync aus; `--no-comfyui` nur für Diagnosefälle.
4. Alternativ: `node src/main.js validate path/to/job.json` und `node src/main.js run path/to/job.json --workdir /abs/workdir` (ComfyUI ist im Produktionspfad Pflicht: Health-Check vor Submit, bei Ausfall `COMFYUI_UNAVAILABLE`; ein explizites `comfyui.enable=false`/`--no-comfyui` schaltet nur den Testpfad frei).
5. `VIDAX_CONFIG=... node src/vidax/server.js` startet die API (Config-Auflösung: `VIDAX_CONFIG` → `VA_STATE_DIR/state/config/vidax.json` → `config/vidax.json`)

## Features
### Implemented (Code)
- Setup/Installer: `va doctor` prüft ffmpeg/ffprobe/node (Python optional) und liefert Exit 20 bei fehlendem ffmpeg/ffprobe; `va install` erzeugt StateDir unter `VA_STATE_DIR/state` (default `~/.va/state`), kopiert Beispiel-Configs in `state/config` (`vidax.json`, `lipsync.providers.json`, `assets.json`) und lädt/verifiziert Assets aus dem Manifest (SHA-256, `on_missing` default download, `on_hash_mismatch` fail, `allow_insecure_http=false`, hash-Fehler → `UNSUPPORTED_FORMAT`). Manifest-URLs unterstützen `file://`/relative Quellen (Basis = Manifest-Ordner); das gebündelte Produktions-Workflow-Asset `assets/workflows/vidax_text2img_frames.json` (SDXL Batch) wird nach `state/comfyui/workflows/` installiert (Quelle unter `state/assets/workflows/`).
- CLI-Kommandos `produce`, `validate`, `run`, `status`, `logs` mit Exit-Codes aus `src/errors.js`; `produce` baut/validiert ein Job-JSON aus Flags und startet sofort (Workdir default `./workdir/run-<ts>`, Final `fertig.mp4`), `run` kennt `--workdir` und `--resume`; ComfyUI ist default aktiv (Health-Pflicht), ein explizites Disable dient nur der Diagnose.
- Manifest + Registry: Runs werden unter `~/.va/state/runs.json` registriert; `manifest.json` hält `run_status`/`exit_status`, Phasen, Seeds (inkl. Policy), Audio-Input- und gepaddete Dauer, Buffer, Zielzeit/FPS/Frames sowie applied Params.
- Prepare: Audio-Dauer via `ffprobe`; Buffer `pre_seconds`/`post_seconds` erweitern `visual_target_duration_seconds` und die ComfyUI-Ziel-Frames; Audio wird bei Buffern mit Stille gepaddet (`audio_duration_seconds`), Originaldauer bleibt als `audio_input_duration_seconds`; Input-Hashes sind echte SHA-256-Werte oder `INPUT_NOT_FOUND`; ComfyUI-Seed wird gemäß `seed_policy` (fixed/random) validiert/generiert, im Manifest und `effective_params` abgelegt und an ComfyUI durchgereicht. Die Render-Auflösung wird aus dem Start-Bild/Video geprobt, mod2 geklemmt auf `max_width`/`max_height` (Default 854x480) und überall weitergereicht.
- ComfyUI: Pflicht im Produktionspfad (Health-Check, Fehler → `COMFYUI_UNAVAILABLE`, kein Dummy-Skip). Inline API-Graph für `/prompt` (CheckpointLoaderSimple → CLIPTextEncode pos/neg → EmptyLatentImage → KSampler → VAEDecode → SaveImage) mit Chunking statt `batch_size=target_frames`: Frames werden in konfigurierbaren Chunks (default 4, `comfyui_chunk_size`) erzeugt, Seeds pro Offset deterministisch erhöht, Outputs als PNG nach `workdir/frames/`. Frames werden chunk-stabil sortiert und strikt als `000001.png`, `000002.png`, ... nummeriert; ffmpeg zieht daraus deterministisch über `%06d.png`. Manifest zeichnet `chunk_size`/`chunk_count`, `workflow_id`, `prompt_id` und Output-Pfade auf.
- LipSync: Läuft nur bei `lipsync.enable` (default off) **und** vorhandenem Provider; Config wird zuerst unter `VA_STATE_DIR/state/config/lipsync.providers.json` (bzw. `state_dir` aus `vidax.json`) gesucht, Fallback `config/lipsync.providers.json`; Output `workdir/lipsync/output.mp4`; `allow_passthrough=true` erlaubt Encode trotz Fehler; verarbeitet gepaddete Audioquelle.
- Encode: Reales ffmpeg-Muxing (CFR auf `determinism.fps`) mit gepaddeter Audio-Timeline, Scaling auf die abgeleitete Render-Auflösung, optional Endbild-Hold im Post-Puffer (wenn `end_image` und `post_seconds>0`), Post-Puffer via Frame-Hold. Visual-Priorität: `start_video` liefert das Primärvideo (kein Standbild-Extract), danach ComfyUI Video/Frames; fällt ComfyUI aus und nur `start_image` existiert, entsteht ein deterministischer Ken-Burns-Motion-Fallback (Seed-basiert). Still-Dummy bleibt letzter Notanker. End-Holds werden via re-encoded Concat (scale/fps/yuv420p) an die Hauptspur gehängt, damit Startvideo + Hold stabil bleiben.
- Overwrite/Resume: `final.mp4`/`fertig.mp4` blockiert neuen Lauf ohne `--resume`; Resume verlangt existierendes Manifest und fehlendes Final.
- Logging: `logs/events.jsonl` mit Zeitstempel + Stage/Level; CLI `logs` streamt diese Datei.
- VIDAX API: `GET /health`, `GET /install/status`, `POST /install`, `GET /comfyui/health`, `POST /comfyui/start`, `POST /produce`, `POST /jobs`, `POST /jobs/:id/start`, `GET /jobs/:id`, `/manifest`, `/logs`; API-Key Pflicht über `X-API-Key`, Bind default `127.0.0.1`. ComfyUI-Health nutzt `/system_stats` (Fallback `/health`), Start-Defaults: `python main.py --listen 127.0.0.1 --port 8188`, CWD aus Config; unter Windows wird bei `command=\"python\"` zuerst `venv/Scripts/python.exe` im CWD versucht.

### Planned / Not in Code
- Motion-Stärkeregler, Timing-Files aus den Specs werden nicht validiert oder angewendet.
- Retry-/Backoff-Policy für ComfyUI und Stabilize-Phase fehlen; `seed_policy=per_retry` wird nicht unterstützt.
- Manifest-Erweiterungen wie `runner.log` Alternative und Cleanup-Regeln sind nicht implementiert.
- VIDAX-Fehlercodes für spezifische Startfehler (z.B. `COMFYUI_START_FAILED`) und API-gesteuerte Partial/Resume-Semantik sind nicht vorhanden.

## Docs (Entry Points)
- [`docs/JOB_SCHEMA.md`](docs/JOB_SCHEMA.md)
- [`docs/OUTPUT_CONTRACT.md`](docs/OUTPUT_CONTRACT.md)
- [`docs/COMFYUI_INTERFACE.md`](docs/COMFYUI_INTERFACE.md)
- [`docs/LIPSYNC_INTERFACE.md`](docs/LIPSYNC_INTERFACE.md)
- [`docs/VIDAX_API.md`](docs/VIDAX_API.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md)
- [`docs/SETUP.md`](docs/SETUP.md)
- [`docs/ASSETS.md`](docs/ASSETS.md)
