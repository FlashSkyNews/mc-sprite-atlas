# Sprite-Atlas

Alle Vanilla-Sprites von Minecraft ab 1.21.9 mit MiniMessage-Tags, dazu ein MOTD-Editor mit echtem Server-Abruf.

- `public/index.html`: die Seite (Schrift und Code eingebettet, Sprites kommen aus `public/data/`)
- `public/data/versions.json` + `public/data/<version>.json`: Sprites pro Version, gepflegt vom Update-Skript
- `functions/api/status.js`: Pages Function, die einen Java-Server per Server List Ping abfragt (TCP über `cloudflare:sockets`, SRV über DNS-over-HTTPS)
- `scripts/update-sprites.mjs`: liest Mojangs Versionsmanifest, lädt neue Client-JARs, prüft die SHA-1 und erzeugt die Sprite-Daten aus den Atlas-Definitionen
- `setup/update-sprites.yml`: GitHub-Actions-Job, der das Update täglich ausführt und neue Versionen committet (gehört nach `.github/workflows/`, siehe Einrichten)
- `test/fake-mc.mjs`: Fake-Minecraft-Server zum lokalen Testen

## Einrichten

1. Den täglichen Job aktivieren: Auf GitHub **Add file → Create new file**, als Namen `.github/workflows/update-sprites.yml` eintragen und den Inhalt von [`setup/update-sprites.yml`](setup/update-sprites.yml) hineinkopieren. Danach kann `setup/` gelöscht werden.
2. In Cloudflare: Workers & Pages → Erstellen → Pages → **Mit Git verbinden** → Repo wählen. Build-Befehl leer lassen, Ausgabeordner `public`. Ab jetzt deployt jeder Push automatisch, auch die Commits vom Update-Job.
3. Fertig. Der Job läuft täglich um 05:17 UTC. Manuell starten: GitHub → Actions → „Sprites aktualisieren“ → Run workflow.

Ohne Git-Verbindung geht es auch: Lege im Repo die Secrets `CLOUDFLARE_API_TOKEN` (Berechtigung „Cloudflare Pages: Bearbeiten“) und `CLOUDFLARE_ACCOUNT_ID` an. Dann deployt der Job selbst mit Wrangler.

GitHub pausiert geplante Jobs in Repos, in denen 60 Tage lang nichts passiert. Commits vom Update-Job zählen als Aktivität. Falls Mojang länger kein Release bringt, schickt GitHub vorher eine Mail, und ein Klick reaktiviert den Job.

## Lokal

```bash
npm install
npm run update            # neue Releases nachziehen (lädt von Mojang)
npm run fake-server       # Fake-Minecraft-Server auf 127.0.0.1:25599
npm run dev               # http://localhost:8788
npm run deploy            # manuell auf Cloudflare Pages hochladen (vorher: npx wrangler login)
```

Weitere Optionen des Update-Skripts: `--force` baut alle Versionen neu, `--jar client.jar --version 26.2` liest einen vorhandenen JAR.

## API

`GET /api/status?host=hypixel.net` oder `?host=play.example.de:25566`

Antwort: `{ ok, online, host, port, srv, latency, version, players, description, favicon }`, 30 Sekunden gecacht. Private und lokale Adressen werden abgelehnt. Server hinter Cloudflare Spectrum lassen sich nicht abfragen, weil Cloudflare keine TCP-Verbindungen zu eigenen Adressen erlaubt.
