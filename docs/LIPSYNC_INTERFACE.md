# LipSync Interface

## Provider-Vertrag
- `provider`: string-Name laut Registry; muss eindeutig sein.
- `provider_cli`: CLI-Binary oder Command-Template (z.B. `"autosync --audio {audio} --video {video}"`).
- `params`: freies Objekt; wird unverändert an den Provider übergeben.

## Standardisierte Inputs
- Video/Frames: CFR-Video oder Frame-Ordner unter `workdir/frames`.
- Audio: identisch zum Audio-Master des Jobs.
- Timing/FPS: muss zur Videoquelle passen (fps aus `determinism.fps`).

## Erwartete Outputs
- Lipsync-Video (CFR) mit identischer Dauer wie Audio (max. Drift < 1 Frame).
- Optional: Qualitätsflags `confidence` (0..1) und `viseme_coverage` zur Manifest-Aufnahme.

## Exit-Code-Regeln
- `0`: Erfolg; Output-Video geschrieben.
- `>0`: Fehler → `LIPSYNC_FAILED`; stdout/stderr werden in Logs aufgenommen.

## Fallback-Verhalten
- Wenn `lipsync.enable=false`: Eingabevideo wird unverändert in den Encode-Schritt gegeben; Manifest markiert `lipsync_skipped=true`.
- Bei Fehler und Retryable-Provider: Wiederholung gemäß Retry-Policy; nach Ausschöpfung gilt `LIPSYNC_FAILED`.
- Bei dauerhaftem Fehlschlag kann optional der unstabilisierte Videopfad verwendet werden, wenn `params.allow_passthrough=true` gesetzt ist; sonst Abbruch.
