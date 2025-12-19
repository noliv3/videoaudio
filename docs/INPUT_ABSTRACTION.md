# Eingabeabstraktion: Quellen + Buffer

## Quellenmodell
- **audio_source (Master):** Einzelne Audiodatei oder Stream; bestimmt die normativen Dauer- und Taktraster.
- **visual_source:** Video- oder Bildquelle mit eigener Origin-Länge (z. B. Standbild = unendlich wiederholbar, Video = intrinsische Dauer).
- **Modifikatoren:** Deklarative Angaben, die die Zielzeiträume formen (z. B. Buffer), aber nicht automatisch die Audiolänge verändern.

## Zeitachsen
- **audio_duration:** Tatsächliche Länge der Audiomaster-Quelle; legt den Mux-Horizont fest.
- **visual_generation_duration:** Zielzeitraum für visuelle Synthese = `audio_duration + pre_buffer`; Post-Buffer ist gesperrt, solange kein Audio-Padding existiert.

## Buffer-Typen
- **pre_buffer:** Zeitlicher Vorlauf vor `t=0` des Audiomasters; dient Stabilisierung/Vorbereitung. Wirkt vor LipSync und erweitert nur die visuelle Zielzeit.
- **post_buffer:** Zeitlicher Nachlauf nach Ende des Audiomasters. Aktuell verboten (VALIDATION_ERROR), weil kein Audio-Padding verfügbar ist.

## Harte Regeln
- Audio bleibt Master: **Audio-Mux-Länge = audio_duration**, außer wenn künftig `audio_padding=true` zugelassen wird.
- Buffer beeinflusst visuelle Zielzeitspanne, aber **ändert weder die Audiolänge noch das Mux-Ergebnis**.
- Frames außerhalb der Audio-Dauer sind zulässig nur für visuelle Stabilisierung oder explizit erlaubtes Padding, nicht als implizite Verlängerung.

## Konsequenzen für Verarbeitung
- LipSync arbeitet auf dem unveränderten Audiomaster; Buffer wirkt vorgelagert (Frame-Planung/Prompting) und macht LipSync nicht langsamer.
- Visual Runner (z. B. ComfyUI) darf Frames im Buffer-Bereich generieren; Mux trimmt visuell auf `audio_duration`, solange kein Audio-Padding aktiv ist.
- CLI/API liefern deklarative Quellen + Buffer; sie berechnen keine Frames und verlangen keine expliziten Längen.
