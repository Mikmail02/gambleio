# Gambleio – Deploy og datapersistens

## Viktig: Data må persisteres

Uten persistert lagring vil **alle brukere og data forsvinne** ved hver ny deploy/push. For beta-testing må du bruke en plattform som beholder data mellom deploys.

## Anbefalte plattformer

### Railway / Render / Fly.io
- Kjør `node server.js` som startkommando
- Sett **persistent disk/volume** for `data/`-mappen
- Eller bruk miljøvariabel: `DATA_DIR=/data` og mount en persistent volume på `/data`

### Railway
1. Deploy fra GitHub
2. Legg til **Volume** i prosjektet
3. Mount på f.eks. `/data`
4. Sett miljøvariabel: `DATA_DIR=/data`

### Render
1. Deploy som Web Service
2. Legg til **Disk** (persistent)
3. Mount path: `/data`
4. Sett: `DATA_DIR=/data`

## Miljøvariabler

| Variabel | Beskrivelse |
|----------|-------------|
| `PORT` | Serverport (satt automatisk av de fleste plattformer) |
| `DATA_DIR` | Sti til persistent data-mappe (f.eks. `/data`) |
| `ADMIN_RESET_KEY` | Hemmelig nøkkel for å resette data (valgfritt) |

## Admin-reset (valgfritt)

Når beta er ferdig kan du resette alle data:

```bash
curl -X POST https://din-app.com/api/admin/reset \
  -H "Content-Type: application/json" \
  -d '{"key":"DIN_ADMIN_RESET_KEY"}'
```

Sett `ADMIN_RESET_KEY` i miljøvariablene på deploy-plattformen.

## Plinko-statistikk (backend, ikke synlig)

Serveren teller alle Plinko-ballandinger per multiplier. Hent statistikk (krever ADMIN_RESET_KEY):

```bash
curl "https://din-app.com/api/admin/plinko-stats?key=DIN_ADMIN_RESET_KEY"
```

Eller i nettleser-konsollen (når du er logget inn på siden):

```javascript
fetch('/api/admin/plinko-stats?key=DIN_ADMIN_RESET_KEY').then(r=>r.json()).then(console.log)
```

Data lagres i `data/plinko-stats.json`.

## Lokal testing

Kjør serveren og åpne i nettleser:

```bash
node server.js
```

Åpne **http://localhost:3000** (ikke åpne `index.html` direkte – da vil API-kall feile).

### Resette data for testing

For å starte på nytt (slette alle brukere og sesjoner):

```bash
# Slett data-mappen (Windows PowerShell)
Remove-Item -Recurse -Force data

# Eller manuelt: slett data/users.json og data/sessions.json
```

Start serveren på nytt etterpå.
