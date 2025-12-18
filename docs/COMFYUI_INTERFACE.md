# ComfyUI Interface

## Eingaben an ComfyUI
- Bild/Video-Start: Frame(s) aus `start_image` oder dekodierte Sequenz aus `start_video` (konformer Farbraum, 8/16 Bit wie Workflow verlangt).
- Prompt: `motion.prompt` plus zeitabhängige Overrides aus Timing.
- Seed: gemäß `comfyui.seed_policy` (fix, zufällig pro Job oder pro Retry).
- FPS und `target_frames`: für Sequenz-Generatoren zur Frameanzahl-Steuerung.
- Zusatzparameter: `motion.strength`, `motion.guidance`, Stabilization-Hinweise falls Workflow sie erwartet.

## Erwartete Outputs
- Entweder Frame-Sequenz (PNG/WEBP) oder ein vorgerendertes Video (CFR). Runner akzeptiert beides.
- Metadaten: verwendeter Seed, effektive Workflow-ID, genutzte Steps (falls bereitgestellt) zur Manifest-Schreibung.

## Retry- und Backoff-Policy
- Felder: `max_attempts` (default 3), `base_delay_ms` (default 500), `max_delay_ms` (default 5000), `jitter` (0-1, default 0.25), `timeout_connect`, `timeout_total` (aus Job Schema), `max_retries_per_workflow` (optional, default = `max_attempts`).
- Backoff: exponentiell mit Jitter, gecappt bei `max_delay_ms`.
- Retryable Fehler: `COMFYUI_TIMEOUT`, `COMFYUI_BAD_RESPONSE`, Netzwerk-Disconnects; nicht retryable: `VALIDATION_ERROR`, `UNSUPPORTED_FORMAT`.

## Workflow-Referenz
- Runner speichert nur `workflow_id` (string) und optional eine Liste `workflow_ids` als Fallback; keine Graphen im Job-Dokument.
- Bei mehreren IDs wird in Reihenfolge versucht; jeder Versuch respektiert die Retry-Parameter.

## Timeout-Regeln
- `timeout_connect`: Abbruch, wenn keine Verbindung hergestellt werden kann.
- `timeout_total`: Gesamtzeit pro Versuch inkl. Serverseitiger Ausführung.

## Ausgabevalidierung
- Bei Frame-Outputs muss die Anzahl ≥ `target_frames` sein; zu viele Frames werden auf Audio-Länge getrimmt.
- Bei Video-Outputs wird fps überprüft; VFR-Container werden abgelehnt (`UNSUPPORTED_FORMAT`).
