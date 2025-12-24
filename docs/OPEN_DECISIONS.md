# Offene Entscheidungen

## Frame Rounding
- Optionen: `ceil` (empfohlen), `round`.
- Default-Vorschlag: `ceil`, um keine Unterlänge zu riskieren.

## CFR Strategie
- Optionen: striktes Neu-Encoden aller Inputs auf `determinism.fps` vs. Übernahme von Input-FPS, wenn identisch.
- Default-Vorschlag: immer neu encoden auf Ziel-FPS, um Drift zu vermeiden.

## LipSync Provider Naming
- Optionen: feste Registry-Namen (z.B. `wav2lip`, `emoly`) vs. frei definierbare Strings mit Manifest-Mapping.
- Default-Vorschlag: feste Registry-Namen mit Validierung gegen bekannte Liste.

## Retry Defaults
- Optionen: kurze Basis (z.B. 500ms) vs. längere Basis (z.B. 2000ms); max_attempts 3–5.
- Default-Vorschlag: `max_attempts=3`, `base_delay_ms=500`, `max_delay_ms=5000`, `jitter=0.25`.

## Resume Semantik
- Optionen: striktes Fail bei vorhandenen Outputs vs. Resume, wenn `manifest` vorhanden aber `final.mp4` fehlt.
- Default-Vorschlag: Resume erlauben, wenn `manifest` existiert und `final.mp4` fehlt; sonst Fail bei Overwrite.

## Audio-Padding und Post-Buffer
- Status: Audio-Padding umgesetzt (Stille für `pre_seconds`/`post_seconds`), Video klont letzte Frames für Post-Puffer.
- Offene Frage: Endbilder (`end_image`) werden aktuell nur als Input-Hash erfasst; explizite Conditioning/Transitions fehlen.

## Endbilder
- Stand: Endbild wird als Post-Puffer-Hold benutzt, wenn `post_seconds>0`; es gibt keine Crossfade-Option und keinen Hold ohne Post-Puffer.

## Degraded Output
- Stand: Läufe schreiben immer ein `fertig.mp4`; fehlen ComfyUI-/LipSync-Frames oder schlagen Prompts fehl, wird ein Motion-Basisvideo aus dem Startbild (Zoompan) bzw. das Startvideo encodiert, Manifest markiert `degraded=true` mit Codes wie `COMFYUI_OUTPUTS_MISSING`/`LIPSYNC_FAILED`.
- Offen: Konfigurierbare Bewegungsprofile für den Zoompan-Clip und optionale Wiederholungsversuche für ComfyUI/LipSync sind noch nicht spezifiziert.

## Faceprobe-Erkennung
- Aktuell erzeugt der Runner das Face-Crop/MouthROI deterministisch aus der Bildgeometrie (square pad, MouthROI im unteren Drittel) und nutzt ComfyUI nur für Debug-Saves; eine echte Detector-Integration (InsightFace/RetinaFace o.ä.) steht noch aus.
