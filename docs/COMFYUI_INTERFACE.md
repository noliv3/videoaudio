# ComfyUI Interface

## Eingaben an ComfyUI
- Graph wird zur Laufzeit gebaut und als API-Payload (`POST /prompt`) verschickt. Struktur: `{ "prompt": { "<id>": { "class_type": "...", "inputs": {...} } } }`.
- Quellen: Audio + Startbild oder Startvideo; Prompt/Negative sind optional und werden vom Default-Graph ignoriert.
- Auflösung: aus Start-Bild/-Video via ffprobe abgeleitet, mod2, geklemmt auf `max_width`/`max_height` (Default 854x480); Flags/Params können enger begrenzen.
- Frame-Anzahl: `target_frames` (Audio + Buffer, ceil gerundet) wird als `frame_count` in den Graph gesetzt (`chunk_size=target_frames`, `chunk_count=1`). `frame_rate` entspricht `determinism.fps`.
- Staging: Inputs werden in das Comfy-`input/` kopiert (Prio `comfyui.input_dir` → `COMFYUI_INPUT_DIR` → `COMFYUI_DIR/input`), Dateinamen `vidax_audio_<sha16><ext>` und `vidax_start_<sha16><ext>`, Copy überschreibt nur bei abweichender Größe oder Force.
- Standard-Graph Startbild: `LoadImage(image)` → `RepeatImageBatch(image, amount=frame_count)` → `LoadAudio(audio)` → `VIDAX_Wav2Lip(images,audio,on_no_face=passthrough)` → `SaveImage(filename_prefix=vidax_wav2lip)`.
- Standard-Graph Startvideo: `VHS_LoadVideo(video, force_rate=fps, frame_load_cap=frame_count, force_size=Custom, custom_width/height)` → `LoadAudio(audio)` → `VIDAX_Wav2Lip(images,audio,on_no_face=passthrough)` → `SaveImage(filename_prefix=vidax_wav2lip)`. Links nutzen das Prompt-API-Format `["<node_id>", <output_index>]`, VIDAX_Wav2Lip erhält `images` (Index 0) und `audio` (Index 0).

## Erwartete Outputs
- Frames aus `SaveImage` werden deterministisch in `workdir/frames/000001.png`, `000002.png`, ... gespeichert (Sortierung nach Original-Filename, Fallback URL/Index); daraus wird bei Bedarf `comfyui/comfyui_video.mp4` gerendert.
- Metadaten: Workflow-ID, `chunk_size`/`chunk_count`, `prompt_id` und Output-Typ landen in der ComfyUI-Phase des Manifests (`output_kind`, `output_paths`).
- Wenn die History als abgeschlossen gemeldet wird aber keine Outputs enthält, wird `COMFYUI_OUTPUTS_MISSING` mit zusammengefassten `node_errors`/`messages`/`history_keys`/`output_keys` aus der History gemeldet.

## Submit + Wait + Collect
- ComfyUI ist Pflicht im Produktionspfad. Health-Check vor Submit (strict `/system_stats` mit gültigem Body, kein `/health`-Fallback) und `object_info` müssen erfolgreich sein; Ausfall → `COMFYUI_UNAVAILABLE` (kein Skip, aber der Encode kann später degradiert weiterlaufen).
- Runner ruft `submitPrompt` mit dem Inline-Graph auf, wartet mit `waitForCompletion(prompt_id, {timeout_total, poll_interval_ms=500})` und zieht die gelieferten Files via `collectOutputs`.
- Polling erfolgt über den ComfyUI-History-Endpunkt (`/history/<prompt_id>` oder `/history?prompt_id=`). Timeout führt zu `COMFYUI_TIMEOUT` und ComfyUI-Phase `failed`.
- Output-Priorität: Frames werden sortiert/umbenannt (`%06d.png`), optional zu `workdir/comfyui/comfyui_video.mp4` gerendert. Fehlen Outputs → `COMFYUI_OUTPUTS_MISSING`; der Runner markiert `degraded=true`, protokolliert den Fehlercode (inkl. kompaktem History/Output-Context) und encodiert auf Basis des Startbild- oder Startvideo-Basisclips weiter.
- Fehlen `workflow_id`/ComfyUI-URL trotz aktivem ComfyUI → `COMFYUI_UNAVAILABLE`.
- Fehlende Pflicht-Nodes (`LoadImage`, `RepeatImageBatch`, `LoadAudio`, `VIDAX_Wav2Lip`, `SaveImage`, ggf. `VHS_LoadVideo`) oder fehlende Wav2Lip-Weights lösen `COMFYUI_BAD_RESPONSE` aus; bei aktivem ComfyUI gibt es keinen Fallback-Encode.

## Workflow-Referenz
- `workflow_ids` dienen nur als Auswahl/Kennzeichen; `va produce` setzt je nach Startquelle `vidax_wav2lip_image_audio` oder `vidax_wav2lip_video_audio`, der Builder erzeugt den API-Graph im Code (VIDAX_Wav2Lip + VideoHelperSuite).
- Mehrere IDs werden der Reihe nach probiert, falls bereitgestellt.

## Timeout-Regeln
- `timeout_total`: Gesamtzeit pro Versuch inkl. Serverseitiger Ausführung (wird an die Polling-Schleife durchgereicht).

## Ausgabevalidierung
- Bei Frame-Outputs muss die Anzahl ≥ `target_frames` sein; zu viele Frames werden auf Audio-Länge getrimmt.
- Bei Video-Outputs wird fps überprüft; VFR-Container werden abgelehnt (`UNSUPPORTED_FORMAT`); Video-Combine wird ohne Audio betrieben, Audio wird erst im Encode-Schritt hinzugefügt.
