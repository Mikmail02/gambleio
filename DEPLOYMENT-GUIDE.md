# Gambleio – Guide til produksjon med eget domene og database

Denne guiden beskriver hvordan du tar spillet i produksjon med eget domene og ekte database, **gratis eller så billig som mulig**.

---

## Oversikt

| Del | Gratis valg | Billig valg |
|-----|-------------|-------------|
| **App-hosting** | Render (free) / Fly.io / Oracle Cloud | Render (paid) / Railway / VPS |
| **Database** | Supabase (PostgreSQL) / Neon | Samme, eller managed DB |
| **Domene** | Ditt eget (du har kjøpt) | Samme |
| **SSL** | Automatisk (Let's Encrypt) hos de fleste | Samme |

**Anbefalt gratis stack:** **Render** (host) + **Supabase** (database) + **ditt domene**.

---

## Del 1: Database (gratis)

### Supabase (anbefalt – gratis PostgreSQL)

1. Gå til [supabase.com](https://supabase.com) og opprett konto.
2. **New project** – velg organisasjon, navn (f.eks. `gambleio`), passord for databasen (lagre dette sikkert).
3. Vent til prosjektet er klart (1–2 min).
4. Gå til **Project Settings → Database** og kopier:
   - **Connection string (URI)** – bruk "Transaction" eller "Session" mode.
   - Eller: **Host**, **Port**, **Database name**, **User**, **Password** (til miljøvariabler).
5. Du får noe som:  
   `postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres`  
   Lagre passordet sikkert (f.eks. i en password manager).

**Gratis grenser:** 500 MB database, 2 prosjekter – mer enn nok for Gambleio.

---

## Del 2: Hosting (gratis)

### Alternativ A: Render (enklest)

1. Gå til [render.com](https://render.com) og opprett konto (GitHub er enkelst).
2. **New → Web Service**.
3. Koble til GitHub-repoet ditt (eller last opp kode).
4. Innstillinger:
   - **Build command:** `npm install`
   - **Start command:** `npm start` (eller `node server.js`)
   - **Instance type:** Free
5. Under **Environment** legg til:
   - `NODE_ENV=production`
   - `DATABASE_URL=<din Supabase connection string>`
   - Andre variabler appen trenger (se under).
6. Deploy. Du får en URL som `https://gambleio-xxx.onrender.com`.

**Merk:** Free tier "sover" etter 15 min inaktivitet – første forespørsel kan ta 30–60 sekunder.

### Alternativ B: Fly.io

1. Installer [flyctl](https://fly.io/docs/hands-on/install-flyctl/).
2. Logg inn: `fly auth login`.
3. I prosjektmappen: `fly launch` (velg region, ikke Postgres hvis du bruker Supabase).
4. Legg til secrets:  
   `fly secrets set DATABASE_URL="postgresql://..."`
5. Deploy: `fly deploy`.

Gratis: noen få små VMs og 3 GB persistent volume.

### Alternativ C: Oracle Cloud (alltid gratis VPS)

1. Opprett konto på [oracle.com/cloud/free](https://www.oracle.com/cloud/free/).
2. Opprett en "Always Free" VM (Ubuntu).
3. SSH inn og installer Node.js + PM2 (eller Docker).
4. Klon repo, sett miljøvariabler, kjør appen.
5. Åpne port 80/443 i Oracle firewall og pek domene til VM-IP.

Mer manuelt, men 100 % gratis og ingen "sove"-modus.

---

## Del 3: Eget domene

### DNS-oppsett

Hos domeneleverandøren (der du kjøpte domenet) – f.eks. One.com, GoDaddy, Cloudflare, etc.:

**Hvis du bruker Render:**

- Legg til **CNAME**:  
  `www` (eller `app`) → `gambleio-xxx.onrender.com`
- For rotdomene (f.eks. `gambleio.no`): Render støtter "custom root domain" – følg [Render Custom Domains](https://render.com/docs/custom-domains); ofte legger du til både `gambleio.no` og `www.gambleio.no`.

**Hvis du bruker Fly.io:**

- Legg til **A-record** som peker til Fly sine IP-er (står i Fly-dashboard under Custom domain), eller **CNAME** til `xxx.fly.dev`.

**Hvis du bruker Oracle VPS:**

- Legg til **A-record**: `@` og evt. `www` → IP-adressen til VM.

### SSL (HTTPS)

- **Render / Fly.io:** SSL legges automatisk til når du legger inn custom domain (Let's Encrypt).
- **Egen VPS:** Bruk Certbot: `sudo certbot --nginx` (eller Apache) for gratis sertifikat.

---

## Del 4: Hva som må endres i koden (database)

I dag lagrer serveren alt i JSON-filer (`data/users.json`, `sessions.json`, osv.). For produksjon bør dette byttes ut med en ekte database.

### Foreslått database-skjema (PostgreSQL)

```sql
-- Brukere (tilsvarer users.json)
CREATE TABLE users (
  username VARCHAR(255) PRIMARY KEY,
  profile_slug VARCHAR(255),
  display_name VARCHAR(255),
  password_hash VARCHAR(255),
  email VARCHAR(255),
  role VARCHAR(50),
  balance DECIMAL DEFAULT 0,
  xp INTEGER DEFAULT 0,
  level INTEGER DEFAULT 1,
  total_clicks BIGINT DEFAULT 0,
  total_bets BIGINT DEFAULT 0,
  total_gambling_wins DECIMAL DEFAULT 0,
  total_wins_count INTEGER DEFAULT 0,
  biggest_win_amount DECIMAL DEFAULT 0,
  biggest_win_multiplier DECIMAL DEFAULT 1,
  total_click_earnings DECIMAL DEFAULT 0,
  total_profit_wins DECIMAL DEFAULT 0,
  is_owner BOOLEAN DEFAULT FALSE,
  is_admin BOOLEAN DEFAULT FALSE,
  created_at BIGINT,
  analytics_started_at BIGINT,
  -- JSONB for fleksible objekter (game_net, game_play_counts, xp_by_source, osv.)
  game_net JSONB DEFAULT '{}',
  game_play_counts JSONB DEFAULT '{}',
  xp_by_source JSONB DEFAULT '{}',
  plinko_risk_level VARCHAR(50) DEFAULT 'low',
  plinko_risk_unlocked JSONB DEFAULT '{}',
  biggest_win_meta JSONB DEFAULT '{}'
);

-- Økter (sessions)
CREATE TABLE sessions (
  token VARCHAR(255) PRIMARY KEY,
  user_key VARCHAR(255) NOT NULL,
  created_at BIGINT
);

-- Admin-logg
CREATE TABLE admin_logs (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50),
  timestamp BIGINT,
  actor_username VARCHAR(255),
  actor_display_name VARCHAR(255),
  target_username VARCHAR(255),
  target_display_name VARCHAR(255),
  role VARCHAR(50),
  adjust_type VARCHAR(50),
  value NUMERIC,
  new_level INTEGER,
  previous_level INTEGER,
  meta JSONB DEFAULT '{}'
);

-- Plinko-statistikk (global)
CREATE TABLE plinko_stats (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_balls BIGINT DEFAULT 0,
  landings JSONB DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]',
  CONSTRAINT single_row CHECK (id = 1)
);
```

### Node.js – database-tilkobling

Legg til pakken `pg` (PostgreSQL-klient):

```bash
npm install pg
```

I koden: bruk `DATABASE_URL` (eller separate variabler) og bytt ut:

- `loadData()` / `saveUsers()` → les/skriv mot `users`-tabellen
- `sessions` Map → les/skriv mot `sessions`-tabellen
- `adminLogs` + `saveAdminLogs()` → les/skriv mot `admin_logs`
- Plinko-stats → les/skriv mot `plinko_stats`

Eksempel på enkel bruk av `pg`:

```js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false });
// pool.query('SELECT * FROM users WHERE username = $1', [key])
```

Supabase-koblingen bruker port **6543** (connection pooler) og krever SSL i produksjon.

---

## Del 5: Steg-for-steg (Render + Supabase + domene)

1. **Supabase**
   - Opprett prosjekt, noter connection string og passord.

2. **GitHub**
   - Last opp Gambleio til et GitHub-repo (hvis du ikke allerede har).

3. **Render**
   - New → Web Service → koble repo.
   - Build: `npm install`
   - Start: `npm start`
   - Environment: `DATABASE_URL`, `NODE_ENV=production`.
   - (Før database er på plass: appen kan fortsatt bruke filer hvis `DATA_DIR` er satt og du bruker en disk som ikke tømmes – men på free tier er disken ephemeral, derfor **må** du bruke ekstern database for å beholde brukere og progress.)

4. **Database-migrering**
   - Kjør SQL-scriptet over i Supabase (SQL Editor) for å opprette tabeller.
   - Oppdater `server.js` til å bruke `pg` og tabellene (eller bruk en migrasjonsscript som kopierer fra JSON til DB én gang).

5. **Domene**
   - I Render: Settings → Custom Domains → Add `www.dittdomene.no` og evt. rotdomene.
   - Hos domeneleverandør: CNAME (og A for root hvis Render viser det).

6. **Sjekk**
   - Åpne `https://www.dittdomene.no` – skal vise spillet og brukere skal overleve restarts og updates.

---

## Del 6: Miljøvariabler (sjekkliste)

Sett disse i Render (eller annen host) under Environment:

| Variabel | Beskrivelse | Eksempel |
|----------|-------------|----------|
| `NODE_ENV` | `production` | `production` |
| `DATABASE_URL` | Supabase connection string | `postgresql://postgres.[ref]:[PASSWORD]@...pooler.supabase.com:6543/postgres` |
| `PORT` | Port (Render setter ofte selv) | `3000` |

Hvis du fortsatt bruker fil-lagring i en overgangsperiode:

| Variabel | Beskrivelse |
|----------|-------------|
| `DATA_DIR` | Mappe for JSON-filer (kun relevant hvis du ikke bruker DB ennå) |

---

## Del 7: Sikkerhet i produksjon

- **Aldri** committ `DATABASE_URL` eller passord til Git. Bruk alltid miljøvariabler.
- Bruk **HTTPS** (Render/Fly gir dette automatisk med custom domain).
- I Express: vurder `helmet` for sikrere headers: `npm install helmet` og `app.use(require('helmet')())`.
- Begrens CORS til ditt domene når du er klar:  
  `app.use(cors({ origin: 'https://www.dittdomene.no' }))`.

---

## Kort oppsummering

1. **Database:** Opprett Supabase-prosjekt, noter connection string.
2. **Hosting:** Opprett Web Service på Render, koble GitHub-repo, sett `DATABASE_URL` og `NODE_ENV`.
3. **Kode:** Bytt fra JSON-filer til PostgreSQL (tabeller + `pg` i `server.js`).
4. **Domene:** Legg til custom domain i Render, sett CNAME (og evt. A) hos domeneleverandør.
5. **SSL:** Skrus på automatisk hos Render når domene er lagt til.

Da har du spillet live på eget domene med ekte database, gratis (med Render free tier + Supabase free tier). Hvis du vil kan neste steg være at jeg foreslår konkrete endringer i `server.js` (moduler for DB, utflytting av load/save til `users`, `sessions`, `admin_logs`, `plinko_stats`) slik at du bare trenger å kjøre migrasjonen og deploye.
