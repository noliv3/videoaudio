# VideoAudio Pipeline Specification

Spezifikation-first Repository für einen lokalen, skriptbaren Video+Audio-Runner. Ziel: Ein Job hinein, ein fertiges `final.mp4` heraus, getrieben vom Audiomaster und dokumentiert per Manifest.

## Überblick
- **Job-Schema:** Pflichtfelder, Defaults und Validierung sind in [`docs/JOB_SCHEMA.md`](docs/JOB_SCHEMA.md) beschrieben.
- **User-Ziel:** Kurze Zusammenfassung der Eingabe-/Ausgabe-Erwartungen in [`docs/USER_GOAL.md`](docs/USER_GOAL.md).
- **Timing & Einfluss:** Format und Regeln siehe [`docs/TIMING_CONTRACT.md`](docs/TIMING_CONTRACT.md).
- **ComfyUI & LipSync Schnittstellen:** Parameter- und Retry-Verträge in [`docs/COMFYUI_INTERFACE.md`](docs/COMFYUI_INTERFACE.md) und [`docs/LIPSYNC_INTERFACE.md`](docs/LIPSYNC_INTERFACE.md).
- **Outputs & Fehler:** Verbindliche Artefakte in [`docs/OUTPUT_CONTRACT.md`](docs/OUTPUT_CONTRACT.md) und Fehlercodes in [`docs/ERROR_MODEL.md`](docs/ERROR_MODEL.md).
- **Offene Entscheidungen:** Optionen und Defaults in [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md).

Alle Spezifikationen sind normativ; diese README dient nur als Einstieg und Link-Sammlung.
