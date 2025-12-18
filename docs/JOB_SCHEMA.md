# JOB Schema (normativ)

Alle Felder sind in YAML/JSON darstellbar. Validierung schlägt als `VALIDATION_ERROR` fehl, wenn Anforderungen nicht erfüllt sind.

## Obligatorische Gesamtregeln
- Genau **eine** der Quellen `input.start_image` oder `input.start_video` MUSS gesetzt sein; beide oder keine ergeben einen Fehler.
- `input.audio` ist immer erforderlich.
- Pfade dürfen relativ zum `output.workdir` oder absolut sein; mischen relativer und expliziter Zielpfade ist verboten.
- Alle Zeitwerte in Sekunden (float) oder Frames (int) müssen die Einheit deklarieren.
- Seeds, fps und target_frames bestimmen die Reproduzierbarkeit; fehlende Seeds dürfen vom Runner generiert werden und müssen ins Manifest.

## Feldgruppen

### input (required)
| Feld | Typ | Pflicht | Standard | Regeln |
| --- | --- | --- | --- | --- |
| `start_image` | string (Pfad) | XOR mit `start_video` | — | Einzelnes Bild; Formate: png, jpg, jpeg, webp. |
| `start_video` | string (Pfad) | XOR mit `start_image` | — | Videoquelle; Formate: mp4, mov, mkv; muss lesbar sein. |
| `audio` | string (Pfad) | Ja | — | Audio-Master (wav, mp3, flac, m4a). Dauer bestimmt Zielvideo. |
| `end_image` | string (Pfad) | Nein | — | Optionaler Abschlussframe; wird auf die letzte(n) Frames gemappt. |

Validierungsfehler: fehlende oder doppelte Startquelle, fehlende Audio-Datei, nicht unterstütztes Format → `VALIDATION_ERROR` bzw. `INPUT_NOT_FOUND`/`UNSUPPORTED_FORMAT`.

### buffer (optional)
| Feld | Typ | Pflicht | Standard | Regeln |
| --- | --- | --- | --- | --- |
| `pre_seconds` | number | Nein | 0 | Vorlauf vor Audiostart; wirkt vor LipSync und beeinflusst nur die visuelle Zielzeit. |
| `post_seconds` | number | Nein | 0 | Nachlauf nach Audioende; nur erlaubt, wenn `audio_padding=true`. |
| `audio_padding` | boolean | Nein | false | Ermöglicht, dass `post_seconds` > 0 gesetzt werden darf. |

**Regeln:**
- `visual_generation_duration = audio_duration + pre_seconds + post_seconds` (siehe [INPUT_ABSTRACTION](./INPUT_ABSTRACTION.md)).
- Wenn `post_seconds > 0` und `audio_padding` ≠ true → `VALIDATION_ERROR` (Audio bleibt normativer Horizont).
- Buffer ändert nie die Audiolänge oder Mux-Dauer; LipSync arbeitet immer auf der ungepaddeten Audioquelle.

### motion
| Feld | Typ | Pflicht | Standard | Regeln |
| --- | --- | --- | --- | --- |
| `prompt` | string | Ja | — | Textbeschreibung für Bild-/Frame-Generierung. |
| `strength` | number | Nein | 0.5 | 0–1; skaliert Einfluss des Prompts auf Frames (höher = stärker). |
| `guidance` | number | Nein | 7.5 | 0–20; modellabhängige Guidance Scale. |

### timing
| Feld | Typ | Pflicht | Standard | Regeln |
| --- | --- | --- | --- | --- |
| `timing_file` | string (Pfad) | Nein | — | Externe Datei gemäß [TIMING_CONTRACT](./TIMING_CONTRACT.md). |
| `timing` | object | Nein | — | Inline-Objekt mit Segmenten gemäß Timing-Schema. |

Validierungsregeln: Beide Timing-Quellen dürfen nicht gleichzeitig gesetzt sein; Konflikt → `VALIDATION_ERROR`. Ohne Timing gelten Defaults aus [TIMING_CONTRACT](./TIMING_CONTRACT.md).

### lipsync
| Feld | Typ | Pflicht | Standard | Regeln |
| --- | --- | --- | --- | --- |
| `enable` | boolean | Nein | true | Deaktiviert LipSync, wenn false. |
| `provider` | string | Nein | "default" | Muss in [LIPSYNC_INTERFACE](./LIPSYNC_INTERFACE.md) beschrieben sein. |
| `params` | object | Nein | {} | Provider-spezifische Durchreichparameter. |

### comfyui
| Feld | Typ | Pflicht | Standard | Regeln |
| --- | --- | --- | --- | --- |
| `server` | string (URL) | Ja | — | Basis-URL des ComfyUI-Servers. |
| `workflow_ids` | array[string] | Nein | [] | Liste möglicher Workflow-IDs; erste nutzbare wird gewählt. |
| `seed_policy` | string | Nein | "fixed" | Werte: `fixed` (verwende bereitgestellten Seed), `random` (generiere per Job), `per_retry` (neuer Seed pro Versuch). |
| `seed` | integer | Nein | generiert | Nur gültig wenn `seed_policy` ≠ `random` oder explizit übergeben. |
| `retries` | integer | Nein | 2 | Max. Wiederholungen bei retryable Fehlern. |
| `timeout_connect` | integer (ms) | Nein | 5000 | Verbindungstimeout. |
| `timeout_total` | integer (ms) | Nein | 120000 | Gesamtzeit pro Versuch. |

### output
| Feld | Typ | Pflicht | Standard | Regeln |
| --- | --- | --- | --- | --- |
| `workdir` | string (Pfad) | Ja | — | Basisverzeichnis für alle Outputs. Muss existieren oder erzeugbar sein. |
| `final_name` | string | Nein | "final.mp4" | Basename des Endvideos; nur unter `workdir` erlaubt, keine absoluten Zielpfade. |
| `emit_manifest` | boolean | Nein | true | Wenn false → `VALIDATION_ERROR` (Manifest ist Pflicht). |
| `emit_logs` | boolean | Nein | true | Steuert Erstellung von Logs; mindestens eine Log-Datei ist Pflicht. |

**Semantik:**
- `workdir` + feste Dateinamen bestimmen alle Ziele. Keine weiteren expliziten Zielpfade sind erlaubt. `final_name` beeinflusst nur den Basenamen im `workdir`; Manifest und Logs haben festgelegte Namen gemäß [OUTPUT_CONTRACT](./OUTPUT_CONTRACT.md).
- Overwrite-Regeln siehe [OUTPUT_CONTRACT](./OUTPUT_CONTRACT.md).

### determinism
| Feld | Typ | Pflicht | Standard | Regeln |
| --- | --- | --- | --- | --- |
| `fps` | number | Ja | — | CFR-Ausgabe-FPS. Muss mit ComfyUI/ffmpeg kompatibel sein. |
| `audio_master` | boolean | Nein | true | Wenn false → `VALIDATION_ERROR` (Audio ist normativer Taktgeber). |
| `frame_rounding` | string | Nein | "ceil" | Werte: `ceil` oder `round`; regelt Berechnung von `target_frames`. |

**Regeln:**
- Ziel-Frames: `target_frames = frame_rounding(fps * audio_duration_seconds)`; Empfehlung und Default: `ceil`.
- Video darf nicht länger als Audio sein; maximaler Drift: < 1 Frame; überschüssige Frames werden getrimmt (siehe Output-Vertrag).
- FPS ist immer CFR (konstant); VFR wird nicht unterstützt.

## Validierungsfehler
- Fehlende Pflichtfelder oder verbotene Kombinationen → `VALIDATION_ERROR`.
- Nicht gefundene Dateien → `INPUT_NOT_FOUND`.
- Nicht unterstützte Formate → `UNSUPPORTED_FORMAT`.
- Seed-Policy widerspricht bereitgestelltem Seed (z.B. `random` + `seed` gesetzt) → `VALIDATION_ERROR`.
