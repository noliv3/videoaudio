# CLI Input Model

## Ziel
Die CLI sammelt deklarative Eingaben (Quellen + Buffer) und schreibt immer ein normatives `job.json`, ohne Frame- oder Längenberechnungen.

## Flags (Beispiel)
- `--audio <path>`: Pflicht. Definiert `audio_source` (Master) und bestimmt `audio_duration`.
- `--video <path>` oder `--image <path>`: Optional. Setzt `visual_source` mit eigener Origin-Länge.
- `--buffer <seconds>`: Komfort-Flag, setzt `pre_buffer` auf Sekundenwert (alias `--pre-buffer`).
- `--pre-buffer <seconds>` / `--post-buffer <seconds>`: Explizite Buffer-Angaben; `post-buffer` schlägt aktuell immer mit VALIDATION_ERROR fehl (Audio-Padding fehlt).
- `--audio-padding`: Platzhalter für künftige Audiopufferung; aktuell ohne Wirkung.

## Normalisiertes job.json
- Enthält Quellen und Buffer-Werte im `buffer`-Block (siehe `docs/JOB_SCHEMA.md`).
- CLI fügt keine Dauerfelder hinzu; Dauer wird im Backend aus den Quellen bestimmt.
- LipSync/ComfyUI-Parameter bleiben unverändert; Buffer wirkt nur auf die Zielzeitspanne für visuelle Generierung.

## Semantik
- Audio bleibt Master: `audio_duration` bestimmt den Mux-Horizont.
- `visual_generation_duration = audio_duration + pre_buffer`; Post-Buffer wird abgelehnt, solange Audio-Padding fehlt.
- Buffer wirkt vor der LipSync-Phase; CLI verändert Timing nicht, sondern beschreibt nur die Intention.
