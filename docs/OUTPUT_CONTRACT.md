# OUTPUT Contract

## Pflichtartefakte und Dateinamen
- `final.mp4` (CLI `produce` setzt standardmäßig `fertig.mp4` als Basename): Endvideo, CFR, Dauer = gepaddete Audio-Dauer inkl. Buffer (`pre_seconds + post_seconds`), Drift < 1 Frame; visuelle Seite hält das letzte Frame für den Post-Puffer.
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
  comfyui/
    comfyui_video.mp4 (primäres ComfyUI-Output)
  frames/ (optional, wenn ComfyUI Frame-Sequenz liefert)
  lipsync/
    output.mp4 (nur wenn LipSync erfolgreich lief)
  temp/   (optional, interne Zwischenschritte; wird bereinigt)
```

## Manifest Pflichtfelder
- `run_id` (string, unique)
- `timestamps` (object: `created`, `started`, `finished` in ISO-8601)
- `input_hashes` (object: start, audio, end; SHA-256 Hex, `INPUT_NOT_FOUND` falls Datei fehlt)
- `audio_input_duration_seconds` (number; Dauer der gelieferten Audioquelle)
- `audio_duration_seconds` (number; gepaddete Audiodauer nach Buffer-Anwendung)
- `visual_target_duration_seconds` (number; entspricht `audio_input_duration_seconds + pre_buffer + post_buffer`)
- `fps` (number)
- `target_frames` (integer, nach Rounding-Regel)
- `effective_params` (object: final angewandte Job-Parameter inkl. Defaults und generiertem Seed)
- `versions` (object: runner, comfyui_api, lipsync_provider, ffmpeg)
- `seeds` (object: comfyui_seed, comfyui_seed_policy, lipsync_seed falls relevant)
- `run_status` (string enum: `queued`, `running`, `completed`, `failed`)
- `exit_status` (string enum: `success`, `failed`, `partial`, `null`)
- `buffer_applied` (object: `pre_seconds`, `post_seconds`)
- `phases.lipsync` dokumentiert Provider, Input/Output-Pfade und Status `queued|running|completed|failed|skipped`; bei Passthrough bleibt `exit_status=success`, `partial_reason` notiert den LipSync-Fehler.
- `phases.encode` hält `duration_cap_seconds` (Buffer-korrigierte Zieldauer), die Audio-Quelle des Encodes und das genutzte Video-Material (ComfyUI/LipSync/Dummy).

## Cleanup-, Resume- und Overwrite-Regeln
- `workdir` muss erzeugt oder geleert werden können; fehlende Schreibrechte → `OUTPUT_WRITE_FAILED`.
- Resume: Wenn `manifest.json` vorhanden und `final.mp4` fehlt → neuer Lauf darf fortsetzen; vorhandene Frames/Temp können wiederverwendet werden.
- Overwrite: Wenn `final.mp4` existiert und kein explizites Resume-Flag gesetzt ist → Lauf schlägt mit `OUTPUT_WRITE_FAILED` fehl; Logs dürfen angehängt werden.
- Cleanup: `temp/` wird nach erfolgreichem Lauf entfernt, Frames nur wenn kein Bedarf zur Fehlersuche angemeldet ist.

## Synchronisations- und Qualitätsregeln
- Audio ist Master, wird aber bei gesetzten Buffern mit Stille vor-/nachbereitet; Video-Seite klont das letzte Frame um den Post-Puffer abzudecken. Ziel: Drift maximal 1 Frame, ansonsten Fehler `FFMPEG_FAILED`.
- FPS ist CFR; VFR-Ausgaben sind verboten.
- `target_frames` bestimmt erwartete Frameanzahl; wenn die Pipeline mehr liefert, wird auf die gepaddete Zielzeit getrimmt; bei Mangel werden die letzten Frames/ein Endbild dupliziert.
