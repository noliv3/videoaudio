# Benutzerziel

Nutzer:innen reichen einen Job ein und erhalten genau **ein** fertiges Video als Ergebnis.

## Eingaben
- Variante A: `start_image` (einzelnes Standbild) + `audio`.
- Variante B: `start_video` (bestehender Clip) + `audio`.
- Optional: `end_image` als Abschlussframe.

## Ausgaben
- Immer `final.mp4` im Arbeitsverzeichnis, mit CFR, lippensynchron zum Audio.
- Zusatzartefakte: `manifest.json` und Logs (`logs/runner.log` **oder** `logs/events.jsonl`).
- Zielqualität: Audio dominiert die Laufzeit; maximale Abweichung < 1 Frame; deterministische Seeds wenn angegeben.

## Erfolgsbedingungen
- Akzeptierte Eingabe (genau eine der Varianten A/B, gültige Formate).
- Reproduzierbare Parameter (fps, Seeds, Timing) im Manifest dokumentiert.
- Outputs vollständig geschrieben, benannte Pfade eingehalten.

## Nicht-Ziele
- Keine UI-/Frontend-Beschreibung.
- Keine internen Pipeline-Details oder ComfyUI-Graphen.
- Keine automatische Fehlerbehebung jenseits definierter Retries.
