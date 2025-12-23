# ComfyUI Interface

## Eingaben an ComfyUI
- Graph wird zur Laufzeit gebaut und als API-Payload (`POST /prompt`) verschickt. Struktur: `{ "prompt": { "<id>": { "class_type": "...", "inputs": {...} } } }`.
- Quellen: Audio + Startbild oder Startvideo; Prompt/Negative sind optional und werden vom Default-Graph ignoriert.
- Auflösung: aus Start-Bild/-Video via ffprobe abgeleitet, mod2, geklemmt auf `max_width`/`max_height` (Default 854x480); Flags/Params können enger begrenzen.
- Frame-Anzahl: `target_frames` (Audio + Buffer, ceil gerundet) wird als `frame_count` in den Graph gesetzt (`chunk_size=target_frames`, `chunk_count=1`). `frame_rate` entspricht `determinism.fps`.
- Uploads: Startbild/-video und Audio werden via `/upload/image` hochgeladen; Remote-Namen (Basename) fließen direkt in die Nodes ein.
- Standard-Graph Startbild: `LoadImage(image)` → `RepeatImageBatch(images, amount=frame_count)` → `LoadAudio(audio)` → `Wav2Lip(images,audio)` → `VHS_VideoCombine(images, frame_rate=fps, format=video/mp4)`.
- Standard-Graph Startvideo: `VHS_LoadVideo(video, force_rate=fps, frame_load_cap=frame_count, force_size=Custom, custom_width/height)` → `LoadAudio(audio)` → `Wav2Lip(images,audio)` → `VHS_VideoCombine(images, frame_rate=fps, format=video/mp4)`. VHS-Combine liefert ein Video ohne Audio-Track; Audio wird im Runner final gemuxt.

## Erwartete Outputs
- Primär MP4-Video (`comfyui/comfyui_video.mp4`); falls Frames geliefert werden, speichert der Runner sie deterministisch in `workdir/frames/000001.png`, `000002.png`, ...
- Metadaten: Workflow-ID, `chunk_size`/`chunk_count`, `prompt_id` und Output-Typ landen in der ComfyUI-Phase des Manifests (`output_kind`, `output_paths`).

## Submit + Wait + Collect
- ComfyUI ist Pflicht im Produktionspfad. Health-Check vor Submit (default `/system_stats`, Fallback `/health`); Ausfall → `COMFYUI_UNAVAILABLE` (kein Dummy-Fallback).
- Runner ruft `submitPrompt` mit dem Inline-Graph auf, wartet mit `waitForCompletion(prompt_id, {timeout_total, poll_interval_ms=500})` und zieht die gelieferten Files via `collectOutputs`.
- Polling erfolgt über den ComfyUI-History-Endpunkt (`/history/<prompt_id>` oder `/history?prompt_id=`). Timeout führt zu `COMFYUI_TIMEOUT` und ComfyUI-Phase `failed`.
- Output-Priorität: MP4 → `workdir/comfyui/comfyui_video.mp4`; Frames → `workdir/frames/`. Fehlen Outputs → `COMFYUI_BAD_RESPONSE`.
- Fehlen `workflow_id`/ComfyUI-URL trotz aktivem ComfyUI → `COMFYUI_UNAVAILABLE`.

## Workflow-Referenz
- `workflow_ids` dienen nur als Auswahl/Kennzeichen; `va produce` setzt je nach Startquelle `vidax_wav2lip_image_audio` oder `vidax_wav2lip_video_audio`, der Builder erzeugt den API-Graph im Code (Wav2Lip + VideoHelperSuite).
- Mehrere IDs werden der Reihe nach probiert, falls bereitgestellt.

## Timeout-Regeln
- `timeout_total`: Gesamtzeit pro Versuch inkl. Serverseitiger Ausführung (wird an die Polling-Schleife durchgereicht).

## Ausgabevalidierung
- Bei Frame-Outputs muss die Anzahl ≥ `target_frames` sein; zu viele Frames werden auf Audio-Länge getrimmt.
- Bei Video-Outputs wird fps überprüft; VFR-Container werden abgelehnt (`UNSUPPORTED_FORMAT`); Video-Combine wird ohne Audio betrieben, Audio wird erst im Encode-Schritt hinzugefügt.
