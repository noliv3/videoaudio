# Eingabeabstraktion: Quellen + Buffer

## Quellenmodell
- **audio_source (Master):** Einzelne Audiodatei oder Stream; bestimmt die normativen Dauer- und Taktraster.
- **visual_source:** Video- oder Bildquelle mit eigener Origin-Länge (z. B. Standbild = unendlich wiederholbar, Video = intrinsische Dauer).
- **Modifikatoren:** Deklarative Angaben, die die Zielzeiträume formen (z. B. Buffer), aber nicht automatisch die Audiolänge verändern.

## Zeitachsen
- **audio_duration:** Tatsächliche Länge der Audiomaster-Quelle; legt den Mux-Horizont fest.
- **visual_generation_duration:** Zielzeitraum für visuelle Synthese = `audio_duration + pre_buffer + post_buffer`.

## Buffer-Typen
- **pre_buffer:** Zeitlicher Vorlauf vor `t=0` des Audiomasters; dient Stabilisierung/Vorbereitung. Wirkt vor LipSync und erweitert nur die visuelle Zielzeit.
- **post_buffer:** Zeitlicher Nachlauf nach Ende des Audiomasters. Wird mit Stille im Audio und Frame-Hold auf der Video-Seite umgesetzt.

## Harte Regeln
- Audio bleibt Master: **Audio-Mux-Länge = audio_duration + pre_buffer + post_buffer** (Audio wird mit Stille gepaddet).
- Buffer beeinflusst visuelle Zielzeitspanne und die Audiolänge des Encodes (über Padding).
- Frames außerhalb der Original-Audio-Dauer werden durch Frame-Hold (Post) bzw. generierte/padded Frames abgedeckt.

## Konsequenzen für Verarbeitung
- LipSync arbeitet auf der gepaddeten Audioversion; Buffer wirkt vorgelagert (Frame-Planung/Prompting) und verlängert die Audio/Video-Dauer.
- Visual Runner (z. B. ComfyUI) generiert Frames für die gesamte gepaddete Zielzeit; Mux trimmt auf die gepaddete Audiolänge.
- CLI/API liefern deklarative Quellen + Buffer; sie berechnen keine Frames und verlangen keine expliziten Längen.
