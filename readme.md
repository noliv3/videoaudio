# VideoAudio Pipeline Specification

Spezifikation-first Repository für einen lokalen, skriptbaren Video+Audio-Runner. Ziel: Ein Job hinein, ein fertiges `final.mp4` heraus, getrieben vom Audiomaster und dokumentiert per Manifest.

## Überblick
- **Job-Schema:** Pflichtfelder, Defaults und Validierung sind in [`docs/JOB_SCHEMA.md`](docs/JOB_SCHEMA.md) beschrieben.
- **User-Ziel:** Kurze Zusammenfassung der Eingabe-/Ausgabe-Erwartungen in [`docs/USER_GOAL.md`](docs/USER_GOAL.md).
- **Timing & Einfluss:** Format und Regeln siehe [`docs/TIMING_CONTRACT.md`](docs/TIMING_CONTRACT.md).
- **Eingabeabstraktion & Buffer:** Quellenmodell und Buffer-Semantik in [`docs/INPUT_ABSTRACTION.md`](docs/INPUT_ABSTRACTION.md).
- **CLI Input Modell:** Deklarative Flags → Job-Normalisierung in [`docs/CLI_INPUT_MODEL.md`](docs/CLI_INPUT_MODEL.md).
- **ComfyUI & LipSync Schnittstellen:** Parameter- und Retry-Verträge in [`docs/COMFYUI_INTERFACE.md`](docs/COMFYUI_INTERFACE.md) und [`docs/LIPSYNC_INTERFACE.md`](docs/LIPSYNC_INTERFACE.md).
- **Outputs & Fehler:** Verbindliche Artefakte in [`docs/OUTPUT_CONTRACT.md`](docs/OUTPUT_CONTRACT.md) und Fehlercodes in [`docs/ERROR_MODEL.md`](docs/ERROR_MODEL.md).
- **Offene Entscheidungen:** Optionen und Defaults in [`docs/OPEN_DECISIONS.md`](docs/OPEN_DECISIONS.md).
- **VIDAX HTTP API:** Endpunkte, Auth, Statusmodell (`run_status` vs. `exit_status`) und ComfyUI-Lifecycle in [`docs/VIDAX_API.md`](docs/VIDAX_API.md).
- **Sicherheit:** API-Key-Pflicht und Bindungshinweise in [`docs/SECURITY.md`](docs/SECURITY.md).

## Laufzeit-Notizen
- CLI `run` respektiert `--resume`/`resume=1` (API) und verhindert Überschreiben von `final.mp4` ohne expliziten Resume.
- Audio-Dauer wird zur Vorbereitung über `ffprobe` gemessen; Manifest füllt `audio_duration_seconds`, `visual_target_duration_seconds`, `fps` und `target_frames` gemäß Determinismus.
- Encode-Phase erzeugt ein reales `final.mp4` mit ffmpeg: Audio ist Master, Video wird auf `determinism.fps` als CFR getrimmt und endet spätestens mit Audiolänge (Drift <= 1 Frame). Dummy-Video aus Startbild/-frame, falls ComfyUI keine Frames liefert.
- VIDAX verlangt einen gesetzten API-Key und liefert strukturierte Fehlermeldungen mit Codes/Retry-Hinweisen gemäß [`docs/ERROR_MODEL.md`](docs/ERROR_MODEL.md).

Alle Spezifikationen sind normativ; diese README dient nur als Einstieg und Link-Sammlung.
