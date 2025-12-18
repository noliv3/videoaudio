# Timing Contract

## Datenformat
- `timeline_unit`: `seconds` oder `frames` (required, bestimmt die Einheit aller Segmente).
- `fps`: number (required, muss mit `determinism.fps` übereinstimmen, wenn `timeline_unit=frames`).
- `segments`: array von Objekten (required), jeweils:
  - `start`: number (inklusive, Einheit gemäß `timeline_unit`)
  - `end`: number (exklusiv, > start)
  - `weight`: number 0..1 (optional, default 1.0) → Einflussstärke auf Motion.
  - `prompt_override`: string (optional) → ersetzt/ergänzt `motion.prompt` in diesem Intervall.
  - `preset`: string (optional) → symbolischer Name für Motion-Presets.

Validierung: Segmente dürfen sich überlappen; überlappende Bereiche werden nach Gewicht aufgelöst (siehe unten). Negative Werte oder `end<=start` → `VALIDATION_ERROR`.

## Einflussregeln auf Motion
- Basis-Prompt ist `motion.prompt`.
- `prompt_override` ersetzt den Basis-Prompt im Segment; fehlt er, bleibt Basis-Prompt aktiv.
- `weight` moduliert den Einfluss; 0 = ignorieren, 1 = voller Einfluss. Bei überlappenden Segmenten wird der höchste `weight` priorisiert; bei Gleichstand gewinnt das zuletzt definierte Segment.
- `preset` kann nur benutzt werden, wenn vom Runner bekannt; unbekannte Presets → `VALIDATION_ERROR`.

## Konfliktauflösung Prompt vs. Timing
- Wenn `prompt_override` gesetzt, hat es Vorrang vor globalem Prompt.
- Wenn ein Segment `weight=0` besitzt, werden auch Presets/Overrides ignoriert.
- Gibt es kein aktives Segment zu einem Zeitpunkt, gilt der globale Prompt mit Gewicht 1.

## Defaults ohne Timing
- Wenn weder `timing_file` noch `timing` gesetzt sind: ein implizites Segment von Start bis `audio_duration` mit `weight=1`, kein `prompt_override`.

## Stabilization-Spezifikation
- `stabilize.enabled`: boolean, default `false`.
- `stabilize.mode`: enum `none` | `light` | `strong` (default `none` wenn `enabled=false`, sonst `light`).
- `stabilize.lock_face`: boolean, default `true` wenn `enabled=true`, sonst `false`.
- `stabilize.lock_background`: boolean, default `false`.

## Reihenfolgegarantie
- Stabilization wird nach Frame-Generierung, aber vor LipSync angewendet.
- LipSync wirkt auf das stabilisierte Video; Timing beeinflusst die Frame-Inhalte vor Stabilization.

## Frame- und Zeitbezug
- Bei `timeline_unit=seconds` wird Segmentgrenze in Frames über `fps` berechnet; Rounding-Regel gemäß `determinism.frame_rounding`.
- Bei `timeline_unit=frames` gelten Segmentgrenzen direkt als Frame-Indizes.
