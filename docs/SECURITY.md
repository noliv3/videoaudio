# Sicherheit (VIDAX Runner)

- **API Key Pflicht:** Jeder HTTP-Call muss `X-API-Key` senden. Quelle: Env `VIDAX_API_KEY` oder `config/vidax.json` → `apiKey`. Ohne konfigurierten Key startet der Server nicht.
- **Lokale Bindung:** Voreinstellung bindet an `127.0.0.1` (siehe `config/vidax.example.json`). Reverse-Proxy oder Auth-Layer muss nach außen ergänzt werden.
- **Dateizugriff:** Runner liest Pfade aus dem Job. Arbeitsverzeichnis wird erzeugt, Manifest/Logs werden überschrieben, wenn erlaubt; `final.mp4` wird ohne Resume-Flag nicht überschrieben.
- **Auth-Fehler:** Fehlender Key → `401`, falscher Key → `403`, andere Validierungsfehler → `400` laut [`docs/ERROR_MODEL.md`](ERROR_MODEL.md).
- **Logging:** Ereignisse landen in `logs/events.jsonl`; enthält keine Secrets, aber API Key gehört nicht ins Log.
- **Asset-Quellen:** `config/assets.json` darf keine Secrets in URLs oder Query-Strings enthalten; `allow_insecure_http=false` verhindert Klartext-Downloads, Hash-Validierung schützt gegen manipulierte Artefakte.
