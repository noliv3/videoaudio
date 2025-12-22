# ComfyUI Interface

## Eingaben an ComfyUI
- Graph wird zur Laufzeit gebaut und als API-Payload (`POST /prompt`) verschickt. Struktur: `{ "prompt": { "<id>": { "class_type": "...", "inputs": {...} } } }`.
- Prompt-Quellen: `comfyui.params.prompt` oder `motion.prompt`; Negative aus `comfyui.params.negative`/`negative_prompt`.
- Auflösung: aus Start-Bild/-Video via ffprobe abgeleitet, mod2, geklemmt auf `max_width`/`max_height` (Default 854x480); Flags/Params können enger begrenzen.
- Seed: gemäß `comfyui.seed_policy` (`fixed` oder `random`); wird im Manifest abgelegt und an ComfyUI durchgereicht; Chunk-Offsets addieren deterministisch zum Seed.
- Frame-Anzahl: `target_frames` (Audio + Buffer, ceil gerundet) wird in Chunks gerendert (`chunk_size` default 4, `comfyui_chunk_size` überschreibt); jeder Prompt verwendet `frame_count=chunk_size`.
- Zusatzparameter: `steps` (Default 20), `cfg` (Default `motion.guidance` oder 7.5), `sampler` (Default `dpmpp_2m`), `scheduler` (Default `karras`), Checkpoint `sd_xl_base_1.0.safetensors`.

## Erwartete Outputs
- Frame-Sequenz (PNG) aus `SaveImage`; Runner lädt sie nach `workdir/frames/` (Chunk-Outputs werden zusammengeführt).
- Metadaten: verwendeter Seed, Workflow-ID, `chunk_size`/`chunk_count`, `prompt_id` und Output-Typ landen in der ComfyUI-Phase des Manifests (`output_kind`, `output_paths`).

## Submit + Wait + Collect
- ComfyUI ist Pflicht im Produktionspfad. Health-Check vor Submit (default `/system_stats`, Fallback `/health`); Ausfall → `COMFYUI_UNAVAILABLE` (kein Dummy-Fallback).
- Runner ruft `submitPrompt` mit dem Inline-Graph pro Chunk auf, wartet mit `waitForCompletion(prompt_id, {timeout_total, poll_interval_ms=500})` und zieht die gelieferten Files via `collectOutputs`.
- Polling erfolgt über den ComfyUI-History-Endpunkt (`/history/<prompt_id>` oder `/history?prompt_id=`). Timeout führt zu `COMFYUI_TIMEOUT` und ComfyUI-Phase `failed`.
- Output-Priorität: Frames → `workdir/frames/` (Chunk-Merge). Fehlen Outputs → `COMFYUI_BAD_RESPONSE`.
- Fehlen `workflow_id`/ComfyUI-URL trotz aktivem ComfyUI → `COMFYUI_UNAVAILABLE`.

## Workflow-Referenz
- `workflow_ids` dienen nur als Auswahl/Kennzeichen; `va produce` setzt weiterhin `vidax_text2img_frames`, der Builder erzeugt den API-Graph im Code (KSampler Text2Img).
- Mehrere IDs werden der Reihe nach probiert, falls bereitgestellt.

## Timeout-Regeln
- `timeout_total`: Gesamtzeit pro Versuch inkl. Serverseitiger Ausführung (wird an die Polling-Schleife durchgereicht).

## Ausgabevalidierung
- Bei Frame-Outputs muss die Anzahl ≥ `target_frames` sein; zu viele Frames werden auf Audio-Länge getrimmt.
- Bei Video-Outputs wird fps überprüft; VFR-Container werden abgelehnt (`UNSUPPORTED_FORMAT`).
