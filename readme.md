# VideoAudio Runner (Ist-Stand)

Skriptbarer Video+Audio-Runner: Job laden, validieren, optional über VIDAX starten und zu `final.mp4` encodieren. Dokumentation ist normativ, folgt aber dem aktuellen Codezustand.

## Requirements
- Node.js Runtime
- ffmpeg und ffprobe im PATH

## Quickstart (CLI)
1. `node src/main.js doctor` prüft ffmpeg/ffprobe/node (Exit 20 wenn ffmpeg/ffprobe fehlen).
2. `node src/main.js install` legt StateDir + Configs an und zieht Assets gemäß Assets-Manifest (Auflösung: `VIDAX_ASSETS_CONFIG` → `VA_STATE_DIR/state/config/assets.json` → `config/assets.json`; StateDir via `VA_STATE_DIR`, default `~/.va/state`).
3. `node src/main.js produce --audio <A> --start <img|vid> --prompt \"...\" [--neg \"...\"] [--pre/post ...] [--width/height ...] [--lipsync on|off --lipsync_provider <id>] [--workdir ...]` baut ein Job-JSON und startet den Run (Final-Basename `fertig.mp4`).
4. Alternativ: `node src/main.js validate path/to/job.json` und `node src/main.js run path/to/job.json --workdir /abs/workdir` (ComfyUI wird nur genutzt, wenn `comfyui.workflow_ids` gesetzt sind; sonst erzeugt der Runner Dummy-Frames aus Startbild/-frame und muxed direkt).
5. `VIDAX_CONFIG=... node src/vidax/server.js` startet die API (Config-Auflösung: `VIDAX_CONFIG` → `VA_STATE_DIR/state/config/vidax.json` → `config/vidax.json`)

## Features
### Implemented (Code)
- Setup/Installer: `va doctor` prüft ffmpeg/ffprobe/node (Python optional) und liefert Exit 20 bei fehlendem ffmpeg/ffprobe; `va install` erzeugt StateDir unter `VA_STATE_DIR/state` (default `~/.va/state`), kopiert Beispiel-Configs in `state/config` (`vidax.json`, `lipsync.providers.json`, `assets.json`) und lädt/verifiziert Assets aus dem Manifest (SHA-256, `on_missing` default download, `on_hash_mismatch` fail, `allow_insecure_http=false`, hash-Fehler → `UNSUPPORTED_FORMAT`). Manifest-URLs unterstützen `file://`/relative Quellen (Basis = Manifest-Ordner); das gebündelte Produktions-Workflow-Asset `assets/workflows/vidax_text2img_frames.json` (SDXL Batch) wird nach `state/comfyui/workflows/` installiert (Quelle unter `state/assets/workflows/`).
- CLI-Kommandos `produce`, `validate`, `run`, `status`, `logs` mit Exit-Codes aus `src/errors.js`; `produce` baut/validiert ein Job-JSON aus Flags und startet sofort (Workdir default `./workdir/run-<ts>`, Final `fertig.mp4`), `run` kennt `--workdir` und `--resume` und überspringt ComfyUI bei fehlenden `workflow_ids` (Encode nutzt dann Dummy/Startbild + Audio).
- Manifest + Registry: Runs werden unter `~/.va/state/runs.json` registriert; `manifest.json` hält `run_status`/`exit_status`, Phasen, Seeds (inkl. Policy), Audio-Input- und gepaddete Dauer, Buffer, Zielzeit/FPS/Frames sowie applied Params.
- Prepare: Audio-Dauer via `ffprobe`; Buffer `pre_seconds`/`post_seconds` erweitern `visual_target_duration_seconds` und die ComfyUI-Ziel-Frames; Audio wird bei Buffern mit Stille gepaddet (`audio_duration_seconds`), Originaldauer bleibt als `audio_input_duration_seconds`; Input-Hashes sind echte SHA-256-Werte oder `INPUT_NOT_FOUND`; ComfyUI-Seed wird gemäß `seed_policy` (fixed/random) validiert/generiert, im Manifest und `effective_params` abgelegt und an ComfyUI weitergereicht.
- ComfyUI: Payload ist ein inline API-Graph für Vanilla `/prompt` (CheckpointLoaderSimple → CLIPTextEncode pos/neg → EmptyLatentImage mit `batch_size=target_frames` → KSampler → VAEDecode → SaveImage). Parameter-Mapping: Prompt aus `comfyui.params.prompt` oder `motion.prompt`, Negative aus `comfyui.params.negative(_prompt)`, Auflösung 1024x576 (override via `comfyui.params.width/height`), `steps` (Default 20), `cfg` (Default `motion.guidance` oder 7.5), `sampler` (Default `dpmpp_2m`), `scheduler` (Default `karras`), Seed laut Policy. `workflow_ids` dienen als Kennung/Fallback; `va produce` setzt default `vidax_text2img_frames`, `va run` überspringt ComfyUI bei leerer Liste. `submit → wait (poll_interval_ms default 500) → collect` lädt Outputs nach `workdir/comfyui/output.mp4` oder `workdir/frames/`; laufende ComfyUI-Instanzen mit `ok` Health werden nicht durch fehlende Assets blockiert.
- LipSync: Läuft nur bei `lipsync.enable` (default true) **und** vorhandenem Provider; Config wird zuerst unter `VA_STATE_DIR/state/config/lipsync.providers.json` (bzw. `state_dir` aus `vidax.json`) gesucht, Fallback `config/lipsync.providers.json`; Output `workdir/lipsync/output.mp4`; `allow_passthrough=true` erlaubt Encode trotz Fehler; verarbeitet gepaddete Audioquelle.
- Encode: Reales ffmpeg-Muxing (CFR auf `determinism.fps`) mit gepaddeter Audio-Timeline, Post-Puffer via Frame-Hold, Dummy-Video aus Startbild/-frame falls keine ComfyUI-Frames/Videos.
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
