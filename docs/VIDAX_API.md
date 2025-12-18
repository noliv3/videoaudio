# VIDAX API (Stufe 1)

## Authentifizierung
- Header `X-API-Key` ist Pflicht für alle Endpunkte.
- Key-Quelle: `VIDAX_API_KEY` env oder `config/vidax.json` Feld `apiKey`.

## Endpunkte

### POST /jobs
- Body: vollständiges Job-JSON laut `JOB_SCHEMA`.
- Aktionen: Validierung, `run_id` erzeugen, Workdir + `manifest.json` + `logs/events.jsonl` anlegen, Status `queued`.
- Antwort `202 Accepted`:
  ```json
  {"run_id":"<id>","status":"queued","manifest":"<path>","workdir":"<abs>"}
  ```
- Fehler: `400` bei `validation_failed`, `401` ohne/mit falschem API Key.

### POST /jobs/:id/start
- Startet Verarbeitung für vorhandenen Lauf.
- Antwort `202 Accepted` bei Start, Status landet in Manifest/Logs.
- Fehler: `404` wenn Job oder Manifest fehlt.

### GET /jobs/:id
- Liefert Statusübersicht (exit_status + Phasen + Manifestpfad).
- Antwort `200 OK` mit JSON.
- Fehler: `404` wenn Run unbekannt.

### GET /jobs/:id/manifest
- Liefert `manifest.json` als Datei.
- Fehler: `404` wenn unbekannt oder Manifest fehlt.

### GET /jobs/:id/logs
- Liefert `logs/events.jsonl` als `text/plain`.
- Fehler: `404` wenn unbekannt oder Logs fehlen.

## Statusmodell Stufe 1
- `queued` → `running` → `success|failed`.
- Phasen (prepare, comfyui, stabilize, lipsync, encode) werden im Manifest mit `queued|running|skipped|completed` markiert.
- `final.mp4` ist ein Platzhalter; echte Generierung folgt in Stufe 2.
