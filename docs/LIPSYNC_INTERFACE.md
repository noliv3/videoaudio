# LipSync Interface

## Provider-Registry
- Konfiguration via `config/lipsync.providers.json` (Mapping `provider -> { command, args_template[] }`).
- `args_template` darf `{audio}`, `{video}`, `{out}` enthalten; zusätzliche `params` werden als `--key=value` (primitive Werte) angehängt.
- Fehlender oder unbekannter Provider → `VALIDATION_ERROR`.

## Standardisierte Inputs
- Videoquelle: bevorzugt `workdir/comfyui/output.mp4`, sonst temporäres `workdir/temp/pre_lipsync.mp4` (aus Frames/Dummy gerendert).
- Audio: immer `job.input.audio` (Audiomaster, identische Dauer).
- FPS: `determinism.fps`; Video darf Audio nicht überdauern.

## Erwartete Outputs
- `workdir/lipsync/output.mp4` (CFR, Dauer ≤ Audio, Drift < 1 Frame).
- Manifest ergänzt Providername, Input/Output-Pfade und Status `queued|running|completed|failed|skipped`.

## Laufzeit & Logging
- Aufruf erfolgt via `child_process.spawn` mit Provider-CLI laut Registry.
- STDOUT/STDERR werden als Events protokolliert (pro Event max. ~5k Zeichen, gekürzt markiert).
- Exit-Code ≠ 0 → `LIPSYNC_FAILED`.

## Fallback-Regeln
- `lipsync.enable=false` oder fehlender Provider → Phase `skipped`, Encode nutzt ursprüngliche Videoquelle.
- Providerfehler:
  - `params.allow_passthrough=true`: Phase `failed`, Encode läuft mit ursprünglicher Quelle weiter, `exit_status=success`, Manifest führt den Fehler und den Passthrough-Hinweis.
  - sonst: `exit_status=failed`.
