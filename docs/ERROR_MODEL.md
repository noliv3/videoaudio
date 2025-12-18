# Fehler- und Rückgabemodell

## Fehlerklassen
| Code | Bedeutung | User-Message (Richtlinie) | Retryable? |
| --- | --- | --- | --- |
| `VALIDATION_ERROR` | Schema-/Kombinationsfehler im Job | "Job ungültig: <Grund>" | Nein |
| `INPUT_NOT_FOUND` | Referenzierte Datei fehlt | "Eingabedatei nicht gefunden: <Pfad>" | Nein |
| `UNSUPPORTED_FORMAT` | Datei kann nicht gelesen/verarbeitet werden | "Format nicht unterstützt: <Pfad/Typ>" | Nein |
| `COMFYUI_TIMEOUT` | Anfrage an ComfyUI überschreitet Timeout | "ComfyUI Timeout nach <ms>" | Ja |
| `COMFYUI_BAD_RESPONSE` | HTTP/JSON-Fehler von ComfyUI | "ComfyUI Antwort ungültig" | Ja |
| `LIPSYNC_FAILED` | LipSync-Provider meldet Fehler/Exit-Code !=0 | "Lipsync fehlgeschlagen" | Ja, falls Provider als retryable markiert |
| `FFMPEG_FAILED` | Encoding/Muxing schlägt fehl | "Video-Rendering fehlgeschlagen" | Teilweise (nur bei transienten IO-Fehlern) |
| `OUTPUT_WRITE_FAILED` | Schreiben nach `workdir` scheitert/Overwrite-Regeln verletzt | "Kann Ausgabedateien nicht schreiben" | Nein |

## Exit Codes (CLI)
- `0`: Erfolg
- `10`: `VALIDATION_ERROR`
- `20`: `INPUT_NOT_FOUND` oder `UNSUPPORTED_FORMAT`
- `30`: `COMFYUI_TIMEOUT` oder `COMFYUI_BAD_RESPONSE`
- `40`: `LIPSYNC_FAILED`
- `50`: `FFMPEG_FAILED`
- `60`: `OUTPUT_WRITE_FAILED`
- `70`: Unklassifizierter Fehler

## HTTP Status (API)
- `400 Bad Request`: `VALIDATION_ERROR`
- `404 Not Found`: `INPUT_NOT_FOUND`
- `415 Unsupported Media Type`: `UNSUPPORTED_FORMAT`
- `424 Failed Dependency`: `COMFYUI_TIMEOUT`, `COMFYUI_BAD_RESPONSE`, `LIPSYNC_FAILED`
- `500 Internal Server Error`: `FFMPEG_FAILED`, `OUTPUT_WRITE_FAILED`, sonstige Fehler

## Message-Format
- Alle Fehler liefern `code`, `message`, optional `details`, `retryable` (boolean) und `timestamp`.
- Bei Retries muss das Log die Versuchsanzahl festhalten.
