# CLI Input Model

## Ziel
Die CLI sammelt Produktions-Eingaben (`va produce ...`), baut daraus ein vollständiges `job.json` und startet die Pipeline direkt. Frame- und Längenberechnungen bleiben serverseitig, basierend auf Audio + Buffer.

## Flags (Beispiel)
- `va produce --audio <A> --start <A_img_or_vid> [--end <C_img>] [--pre <sec>] [--post <sec>] [--fps N] [--prompt "..."] [--neg "..."] [--width W] [--height H] [--seed_policy fixed|random] [--seed N] [--lipsync on|off] [--lipsync_provider id] [--workdir <dir>] [--comfyui_url <url>]`
- `--audio`: Pflicht, Master-Timeline.
- `--start`: Pflicht, Bild oder Video (XOR).
- `--end`: Optionales Endbild, wird als letzter Hold genutzt.
- `--pre` / `--post`: Buffer in Sekunden; werden durch Audio-Padding (Stille) + Frame-Hold umgesetzt.
- `--prompt`/`--neg`: Pflicht/optional für den Render-Workflow.
- `--width`/`--height`: Standard 1024x576; beeinflusst ComfyUI-Framegröße.
- `--fps`: Standard 25.
- `--seed_policy`/`--seed`: Seed-Weitergabe an ComfyUI (`fixed` oder `random`).
- `--lipsync`: `on|off`, default on; `--lipsync_provider` benennt den Provider (Pflicht, wenn LipSync aktiv ist).
- `--workdir`: Basis für Output (default `./workdir/run-<ts>`); Final-Basename `fertig.mp4`.

## Normalisiertes job.json
- Enthält Quellen (audio/start/end) + Buffer in `buffer`, determinism (`fps`, `frame_rounding=ceil`), Lipsync-Konfiguration und ComfyUI-Parameter (Prompt, Negative, Auflösung, Seed-Policy, Workflow-ID `vidax_text2img_frames` als Default im Produce-Pfad).
- Workdir wird aufgelöst/absolut gesetzt, `final_name` = `fertig.mp4`.
- Dauerberechnung bleibt im Runner: `visual_target_duration = audio_duration + pre + post`, `target_frames` via `ceil(fps*duration)`.

## Semantik
- Audio bleibt Master, wird bei gesetztem Buffer mit Stille gepaddet; Video hält das letzte Frame für den Post-Puffer.
- `visual_generation_duration = audio_duration + pre + post`; `target_frames` wird daraus abgeleitet und an ComfyUI als `frame_count` durchgereicht.
- Buffer wirkt vor LipSync; LipSync verarbeitet die gepaddete Audio-/Videoversion.
