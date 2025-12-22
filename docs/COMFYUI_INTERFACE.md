# ComfyUI Interface

## Eingaben an ComfyUI
- Graph wird zur Laufzeit gebaut und als API-Payload (`POST /prompt`) verschickt. Struktur: `{ "prompt": { "<id>": { "class_type": "...", "inputs": {...} } } }`.
- Prompt-Quellen: `comfyui.params.prompt` oder `motion.prompt`; Negative aus `comfyui.params.negative`/`negative_prompt`.
- Auflösung: `width`/`height` mit Default 1024x576.
- Seed: gemäß `comfyui.seed_policy` (`fixed` oder `random`); wird im Manifest abgelegt und an ComfyUI durchgereicht.
- Frame-Anzahl: `frame_count = target_frames` (aus Audio + Buffer, ceil gerundet); landet als `batch_size` im Latent-Node.
- Zusatzparameter: `steps` (Default 20), `cfg` (Default `motion.guidance` oder 7.5), `sampler` (Default `dpmpp_2m`), `scheduler` (Default `karras`), Checkpoint `sd_xl_base_1.0.safetensors`.

## Erwartete Outputs
- Frame-Sequenz (PNG) aus `SaveImage`; Runner lädt sie nach `workdir/frames/`.
- Metadaten: verwendeter Seed, Workflow-ID (falls gesetzt), prompt_id und Output-Typ landen in der ComfyUI-Phase des Manifests (`output_kind`, `output_paths`).

## Submit + Wait + Collect
- Wenn `workflow_id` gesetzt: Runner ruft `submitPrompt` mit dem Inline-Graph auf, wartet mit `waitForCompletion(prompt_id, {timeout_total, poll_interval_ms=500})` und zieht die gelieferten Files via `collectOutputs`.
- Polling erfolgt über den ComfyUI-History-Endpunkt (`/history/<prompt_id>` oder `/history?prompt_id=`). Timeout führt zu `COMFYUI_TIMEOUT` und ComfyUI-Phase `failed`.
- Output-Priorität: bereitgestelltes Video → `workdir/comfyui/output.mp4`, sonst Frames → `workdir/frames/`. Fehlen Outputs → `COMFYUI_BAD_RESPONSE`.
- Bei fehlender `workflow_id` wird die ComfyUI-Phase `skipped` markiert; Encode nutzt Dummy/Startbild oder Startframe.

## Workflow-Referenz
- `workflow_ids` dienen nur als Auswahl/Kennzeichen; CLI-`run` erzwingt keinen Default. `va produce` setzt weiterhin `vidax_text2img_frames`, der Builder erzeugt jedoch immer den API-Graph im Code.
- Mehrere IDs werden der Reihe nach probiert, falls bereitgestellt.

## Timeout-Regeln
- `timeout_total`: Gesamtzeit pro Versuch inkl. Serverseitiger Ausführung (wird an die Polling-Schleife durchgereicht).

## Ausgabevalidierung
- Bei Frame-Outputs muss die Anzahl ≥ `target_frames` sein; zu viele Frames werden auf Audio-Länge getrimmt.
- Bei Video-Outputs wird fps überprüft; VFR-Container werden abgelehnt (`UNSUPPORTED_FORMAT`).
