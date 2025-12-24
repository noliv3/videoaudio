# VIDAX API (Stufe 1)

## Authentifizierung
- Header `X-API-Key` ist Pflicht für alle Endpunkte.
- Key-Quelle: `VIDAX_API_KEY` env oder `vidax.json` (Auflösung: `VIDAX_CONFIG` → `VA_STATE_DIR/state/config/vidax.json` → `config/vidax.json`).
- Fehlender Key führt zu `401`, falscher Key zu `403`; ohne Key startet der Server nicht.

## Endpunkte

### GET /health
- Antwort `200 OK` mit `{ok:true}` als Minimal-Readiness.

### GET /install/status
- Antwort `200 OK` mit `{ok:boolean, assets:{...}}` aus dem Assets-Checker (`install=false`).
- Keine Downloads; meldet `missing`, `hash_mismatch` oder `unknown` für Einträge aus dem aufgelösten Manifest (`VIDAX_ASSETS_CONFIG` → `VA_STATE_DIR/state/config/assets.json` → `config/assets.json`).
- Fehler: `404` bei fehlender Manifest-Datei (`INPUT_NOT_FOUND`), `400` bei Parserfehlern (`VALIDATION_ERROR`).

### POST /install
- Führt `ensureAllAssets` aus (`install=true`), lädt + verifiziert gemäß Manifest-Policy (`on_missing` default download, `on_hash_mismatch` default fail); Download/Hash-Fehler mappen auf `UNSUPPORTED_FORMAT`, Schreib-/Unzip-Probleme auf `OUTPUT_WRITE_FAILED`.
- Antwort `200 OK` mit `{ok:true, assets:{...}}` wenn alles vorhanden ist.
- Fehler: `400` bei fehlgeschlagener Installation/Verification (`UNSUPPORTED_FORMAT`), `404` bei fehlender Manifest-Datei.

### GET /comfyui/health
- Antwort `200 OK` mit `{ok:boolean, ...}` aus dem strikten ComfyUI Health-Check (`/system_stats` als Pflicht-Endpunkt, kein `/health`-Fallback).
- `ok=true`, sobald `/system_stats` einen `200`-Status liefert und einen Body zurückgibt; `ok=false` wenn ComfyUI nicht erreichbar.

### POST /comfyui/start
- Startet ComfyUI falls Health nicht `ok` und `auto_start=true`.
- Default-Startbefehl: `python` mit Args `["main.py","--listen","127.0.0.1","--port","8188"]`, CWD aus `comfyui.cwd` (Default Repo-Wurzel). Unter Windows wird bei `command="python"` automatisch `<cwd>/venv/Scripts/python.exe` bevorzugt.
- Antwort `202 Accepted` mit `{ok:true,status:"ready",url:"..."}`.
- Fehler: `500` mit Fehlercode `COMFYUI_TIMEOUT|COMFYUI_START_FAILED`.

### POST /produce
- Body: vereinfachte Produktions-Payload analog zur CLI (`audio`, `start`, optional `end`, `pre`, `post`, `fps`, `prompt`, `neg`, `width`, `height`, `seed_policy|seed`, `lipsync`/`lipsync_provider` (Provider Pflicht, wenn LipSync aktiv), optional `workdir`, `comfyui_url`).
- Workdir: falls nicht gesetzt → `~/.va/state/runs/<run_id>`, `final_name=fertig.mp4`.
- Aktionen: Payload → Job-Build → `runJob` (inkl. Manifest/Logs im Workdir) mit sofortigem Start.
- Antwort `202 Accepted` mit `{run_id,status,manifest,workdir}`.
- Fehler: `400` bei `VALIDATION_ERROR`, `401/403` bei Auth-Fehlern, `424` bei ComfyUI/LipSync-Fehlern, `415` bei Audioformatproblemen.

### POST /jobs
- Body: vollständiges Job-JSON laut `JOB_SCHEMA`.
- Aktionen: Validierung, `run_id` erzeugen, Workdir + `manifest.json` + `logs/events.jsonl` anlegen, Status `queued`.
- Antwort `202 Accepted`:
  ```json
  {"run_id":"<id>","status":"queued","manifest":"<path>","workdir":"<abs>"}
  ```
- Fehler: `400` bei `VALIDATION_ERROR`, `401/403` bei Auth-Fehlern, `415` bei `UNSUPPORTED_FORMAT`.

### POST /jobs/:id/start
- Startet Verarbeitung für vorhandenen Lauf.
- Ablauf:
  - Job + Paths aus Memory/Disk laden.
  - Overwrite-Regeln: vorhandenes `final.mp4` → `OUTPUT_WRITE_FAILED`; Resume nur erlaubt, wenn Manifest existiert und `final.mp4` fehlt.
  - `processManager.ensureComfyUI()` prüft zunächst die laufende Instanz; wenn Health `ok` ist, blockieren fehlende Assets nicht. Beim Auto-Start gelten Manifest-Assets als Pflicht (`INPUT_NOT_FOUND`/`UNSUPPORTED_FORMAT` bei Download/Hash-Problemen); Health/Start-Fehler mappen auf `424` (`COMFYUI_UNAVAILABLE|COMFYUI_TIMEOUT`), interne Fehler auf `500`.
  - Runner `comfyui`-Phase führt `submit -> wait -> collect` aus und kopiert Outputs nach `workdir/comfyui/output.mp4` oder `workdir/frames/`.
  - Runner `comfyui`-Phase wird mit Kontext `{ comfyuiClient, processManager }` ausgeführt.
- Antwort `202 Accepted` bei Start, Status landet in Manifest/Logs.
- Fehler: `404` wenn Job oder Manifest fehlt; `415` bei Audioformatproblemen; `424` bei ComfyUI-Fehlern.

### GET /jobs/:id
- Liefert Statusübersicht (`run_status`, `exit_status`, Phasen + Manifestpfad).
- Antwort `200 OK` mit JSON.
- Fehler: `404` wenn Run unbekannt.

### GET /jobs/:id/manifest
- Liefert `manifest.json` als Datei.
- Fehler: `404` wenn unbekannt oder Manifest fehlt.

### GET /jobs/:id/logs
- Liefert `logs/events.jsonl` als `text/plain`.
- Fehler: `404` wenn unbekannt oder Logs fehlen.

## Statusmodell Stufe 1
- Lauf-Status: `run_status` mit `queued|running|completed|failed`.
- Ergebnis-Status: `exit_status` mit `success|failed|partial|null` (kein `queued|running`).
- Phasen (prepare, comfyui, stabilize, lipsync, encode) werden im Manifest mit `queued|running|skipped|completed|failed` markiert.
- LipSync läuft real, wenn `lipsync.enable=true` und ein Provider aus `config/lipsync.providers.json` verfügbar ist; Output liegt unter `workdir/lipsync/output.mp4`, bei `allow_passthrough=true` kann `exit_status=success` bleiben obwohl die Phase `failed` ist.
- `final.mp4`/`fertig.mp4` wird mit gemessener gepaddeter Audio-Timeline (Buffer als Stille + Post-Frame-Hold) encodiert; Drift < 1 Frame, Ausgaben mit ≤1 Frame schlagen fehl. Resume setzt `exit_status=partial`, solange kein Final existiert.
