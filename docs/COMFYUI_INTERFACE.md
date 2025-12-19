# ComfyUI Interface

## Eingaben an ComfyUI
- Bild/Video-Start: Frame(s) aus `start_image` oder dekodierte Sequenz aus `start_video` (konformer Farbraum, 8/16 Bit wie Workflow verlangt).
- Prompt: `motion.prompt` plus zeitabhängige Overrides aus Timing.
- Seed: gemäß `comfyui.seed_policy` (fix, zufällig pro Job oder pro Retry).
- FPS und `target_frames`: für Sequenz-Generatoren zur Frameanzahl-Steuerung.
- Zusatzparameter: `motion.strength`, `motion.guidance`, Stabilization-Hinweise falls Workflow sie erwartet.

## Erwartete Outputs
- Entweder Frame-Sequenz (PNG/WEBP) oder ein vorgerendertes Video (CFR). Runner akzeptiert beides und kopiert die Outputs in `workdir/comfyui/output.mp4` bzw. `workdir/frames/%06d.png`.
- Metadaten: verwendeter Seed, Workflow-ID, prompt_id und Output-Typ landen in der ComfyUI-Phase des Manifests (`output_kind`, `output_paths`).

## Retry- und Backoff-Policy
- Felder: `max_attempts` (default 3), `base_delay_ms` (default 500), `max_delay_ms` (default 5000), `jitter` (0-1, default 0.25), `timeout_connect`, `timeout_total` (aus Job Schema), `max_retries_per_workflow` (optional, default = `max_attempts`).
- Backoff: exponentiell mit Jitter, gecappt bei `max_delay_ms`.
- Retryable Fehler: `COMFYUI_TIMEOUT`, `COMFYUI_BAD_RESPONSE`, Netzwerk-Disconnects; nicht retryable: `VALIDATION_ERROR`, `UNSUPPORTED_FORMAT`.

## Submit + Wait + Collect
- Wenn `workflow_id` gesetzt: Runner ruft `submitPrompt(payload)` auf, wartet mit `waitForCompletion(prompt_id, {timeout_total, poll_interval_ms=500})` auf Abschluss und zieht die gelieferten Files via `collectOutputs`.
- Polling erfolgt über den ComfyUI-History-Endpunkt (`/history/<prompt_id>` oder `/history?prompt_id=`). Timeout führt zu `COMFYUI_TIMEOUT` und ComfyUI-Phase `failed`.
- Output-Priorität: bereitgestelltes Video → `workdir/comfyui/output.mp4`, sonst Frames → `workdir/frames/`. Fehlen Outputs → `COMFYUI_BAD_RESPONSE`.
- Bei fehlender `workflow_id` wird die ComfyUI-Phase `skipped` markiert; encode nutzt Dummy/Startbild.

## Workflow-Referenz
- Runner speichert nur `workflow_id` (string) und optional eine Liste `workflow_ids` als Fallback; keine Graphen im Job-Dokument.
- Bei mehreren IDs wird in Reihenfolge versucht; jeder Versuch respektiert die Retry-Parameter.
- Fehlt `workflow_ids`, verwendet der Runner automatisch `vidax_text2img_frames` (bundled Core-Only Workflow). Parameter-Mapping: Prompt aus `comfyui.params.prompt` oder `motion.prompt`, Negative aus `comfyui.params.negative(_prompt)`, Auflösung `width/height` (Default 768), `steps` (Default 20), `cfg` (Default `motion.guidance` oder 7.5), `sampler` (Default `dpmpp_2m`), `scheduler` (Default `karras`), Seed aus der Policy. Output: PNG-Frames via `SaveImage` → `workdir/frames/`.

## Timeout-Regeln
- `timeout_connect`: Abbruch, wenn keine Verbindung hergestellt werden kann.
- `timeout_total`: Gesamtzeit pro Versuch inkl. Serverseitiger Ausführung.

## Ausgabevalidierung
- Bei Frame-Outputs muss die Anzahl ≥ `target_frames` sein; zu viele Frames werden auf Audio-Länge getrimmt.
- Bei Video-Outputs wird fps überprüft; VFR-Container werden abgelehnt (`UNSUPPORTED_FORMAT`).
