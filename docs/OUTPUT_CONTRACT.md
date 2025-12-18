# OUTPUT Contract

## Pflichtartefakte und Dateinamen
- `final.mp4`: Endvideo, CFR, Dauer durch Audio bestimmt, maximale Abweichung < 1 Frame; Länge wird bei Bedarf auf Audio gekürzt.
- `manifest.json`: Metadaten des Laufs (siehe Pflichtfelder).
- Logs: genau eine der Varianten MUSS existieren
  - `logs/runner.log` (Text/rotierend) **oder**
  - `logs/events.jsonl` (line-delimited JSON Events).

## Ordnerlayout (unter `output.workdir`)
```
workdir/
  final.mp4
  manifest.json
  logs/
    runner.log (optional, wenn events.jsonl fehlt)
    events.jsonl (optional, wenn runner.log fehlt)
  frames/ (optional, wenn ComfyUI Frame-Sequenz liefert)
  temp/   (optional, interne Zwischenschritte; wird bereinigt)
```

## Manifest Pflichtfelder
- `run_id` (string, unique)
- `timestamps` (object: `created`, `started`, `finished` in ISO-8601)
- `input_hashes` (object: start, audio, end; leer, falls optional fehlt)
- `audio_duration_seconds` (number)
- `fps` (number)
- `target_frames` (integer, nach Rounding-Regel)
- `effective_params` (object: final angewandte Job-Parameter inkl. Defaults)
- `versions` (object: runner, comfyui_api, lipsync_provider, ffmpeg)
- `seeds` (object: comfyui_seed, lipsync_seed falls relevant)
- `exit_status` (string enum: `success`, `failed`, `partial`)

## Cleanup-, Resume- und Overwrite-Regeln
- `workdir` muss erzeugt oder geleert werden können; fehlende Schreibrechte → `OUTPUT_WRITE_FAILED`.
- Resume: Wenn `manifest.json` vorhanden und `final.mp4` fehlt → neuer Lauf darf fortsetzen; vorhandene Frames/Temp können wiederverwendet werden.
- Overwrite: Wenn `final.mp4` existiert und kein explizites Resume-Flag gesetzt ist → Lauf schlägt mit `OUTPUT_WRITE_FAILED` fehl; Logs dürfen angehängt werden.
- Cleanup: `temp/` wird nach erfolgreichem Lauf entfernt, Frames nur wenn kein Bedarf zur Fehlersuche angemeldet ist.

## Synchronisations- und Qualitätsregeln
- Audio ist Master: Ausgabe darf nicht länger als Audio sein; Drift maximal 1 Frame, ansonsten Fehler `FFMPEG_FAILED`.
- FPS ist CFR; VFR-Ausgaben sind verboten.
- `target_frames` bestimmt erwartete Frameanzahl; wenn die Pipeline mehr liefert, wird auf Audio-Länge getrimmt; bei Mangel werden die letzten Frames/ein Endbild dupliziert.
