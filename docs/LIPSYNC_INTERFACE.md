# LipSync Interface

## Provider-Registry
- Konfiguration via `VA_STATE_DIR/state/config/lipsync.providers.json` (oder `state_dir` aus `vidax.json`); Fallback auf Repo `config/lipsync.providers.json`. Format: Mapping `provider -> { command, args_template[] }`.
- `args_template` darf `{audio}`, `{video}`, `{out}` enthalten; zusätzliche `params` werden als `--key=value` (primitive Werte) angehängt.
- Fehlender Provider ist nur bei `lipsync.enable=true` ein Fehler; unbekannte Provider-Namen bleiben `VALIDATION_ERROR`.

## Standardisierte Inputs
- Videoquelle: bevorzugt `workdir/comfyui/output.mp4`, sonst temporäres `workdir/temp/pre_lipsync.mp4` (aus Frames/Dummy gerendert).
- Audio: gepaddete Audioquelle (Audiomaster inkl. Buffer); identische Dauer wie gewünschter Encode-Horizont.
- FPS: `determinism.fps`; Video soll den gepaddeten Audiohorizont treffen (Frame-Hold ergänzt fehlende Frames).

## Erwartete Outputs
- `workdir/lipsync/output.mp4` (CFR, Dauer = gepaddete Audiodauer, Drift < 1 Frame).
- Manifest ergänzt Providername, Input/Output-Pfade und Status `queued|running|completed|failed|skipped`.

## Laufzeit & Logging
- Aufruf erfolgt via `child_process.spawn` mit Provider-CLI laut Registry.
- STDOUT/STDERR werden als Events protokolliert (pro Event max. ~5k Zeichen, gekürzt markiert).
- Exit-Code ≠ 0 → `LIPSYNC_FAILED`.

## Fallback-Regeln
- `lipsync.enable=false` → Phase `skipped`; bei `lipsync.enable=true` ohne Provider greift die Validierung (`VALIDATION_ERROR`). Encode nutzt bei Skip die ursprüngliche Videoquelle.
- Providerfehler oder fehlende LipSync-Frames degradieren den Run: Phase `failed`, Manifest markiert `degraded=true` und `degraded_reason=LIPSYNC_FAILED`, Encode läuft mit der Basisquelle (ComfyUI-Output falls vorhanden, sonst Motion-Fallback) weiter, unabhängig von `allow_passthrough`.
