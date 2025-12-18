# Sicherheit (VIDAX Runner)

- **API Key Pflicht:** Jeder HTTP-Call muss `X-API-Key` senden. Quelle: Env `VIDAX_API_KEY` oder `config/vidax.json` → `apiKey`.
- **Lokale Bindung:** Voreinstellung bindet an `127.0.0.1` (siehe `config/vidax.example.json`). Reverse-Proxy oder Auth-Layer muss nach außen ergänzt werden.
- **Dateizugriff:** Runner liest Pfade aus dem Job. Arbeitsverzeichnis wird erzeugt, Manifest/Logs werden überschrieben, wenn erlaubt.
- **Keine offenen Ports ohne Key:** Bei fehlendem Key startet der Server nicht korrekt (500 auf Requests).
- **Logging:** Ereignisse landen in `logs/events.jsonl`; enthält keine Secrets, aber API Key gehört nicht ins Log.
