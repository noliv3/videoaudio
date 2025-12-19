# VIDAX API (Stufe 1)

## Authentifizierung
- Header `X-API-Key` ist Pflicht für alle Endpunkte.
- Key-Quelle: `VIDAX_API_KEY` env oder `config/vidax.json` Feld `apiKey`.
- Fehlender Key führt zu `401`, falscher Key zu `403`; ohne Key startet der Server nicht.

## Endpunkte

### GET /health
- Antwort `200 OK` mit `{ok:true}` als Minimal-Readiness.

### GET /install/status
- Antwort `200 OK` mit `{ok:boolean, assets:{...}}` aus dem Assets-Checker (`install=false`).
- Keine Downloads; meldet `missing`, `hash_mismatch` oder `unknown` für Einträge aus `config/assets.json` bzw. `VIDAX_ASSETS_CONFIG`.
- Fehler: `404` bei fehlender Manifest-Datei (`INPUT_NOT_FOUND`), `400` bei Parserfehlern (`VALIDATION_ERROR`).

### POST /install
- Führt `ensureAllAssets` aus (`install=true`), lädt + verifiziert gemäß Manifest-Policy (`on_missing` default download, `on_hash_mismatch` default fail).
- Antwort `200 OK` mit `{ok:true, assets:{...}}` wenn alles vorhanden ist.
- Fehler: `400` bei fehlgeschlagener Installation/Verification (`VALIDATION_ERROR`), `404` bei fehlender Manifest-Datei.

### GET /comfyui/health
- Antwort `200 OK` mit `{ok:boolean, ...}` aus ComfyUI Health-Check.
- `ok=false` wenn ComfyUI nicht erreichbar.

### POST /comfyui/start
- Startet ComfyUI falls Health nicht `ok` und `auto_start=true`.
- Antwort `202 Accepted` mit `{ok:true,status:"ready",url:"..."}`.
- Fehler: `500` mit Fehlercode `COMFYUI_TIMEOUT|COMFYUI_START_FAILED`.

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
  - `processManager.ensureComfyUI()` wird vor Job-Start ausgeführt; fehlt ein Asset aus dem Manifest → `INPUT_NOT_FOUND`/`VALIDATION_ERROR`; Health/Start-Fehler mappen auf `424` (`COMFYUI_UNAVAILABLE|COMFYUI_TIMEOUT`), interne Fehler auf `500`.
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
- `final.mp4` ist ein Platzhalter; echte Generierung folgt in Stufe 2. Resume setzt `exit_status=partial` und lässt `final.mp4` unüberschrieben, bis echtes Encoding vorhanden ist.
