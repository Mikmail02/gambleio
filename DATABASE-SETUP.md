# Slik kobler du Gambleio mot databasen

Når `DATABASE_URL` er satt, lagres brukere, sesjoner, statistikk og plinko-tall i PostgreSQL (f.eks. Supabase). Nye deployer sletter ikke lenger data.

---

## 1. Opprett prosjekt og database (Supabase)

1. Gå til [supabase.com](https://supabase.com) og logg inn.
2. Lag et nytt prosjekt (eller bruk eksisterende).
3. Gå til **Project Settings** → **Database**.
4. Kopier **Connection string** under "URI". Den ser slik ut:
   ```
   postgresql://postgres.[prosjekt-ref]:[passord]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
   Bruk **Transaction**-modus (port 6543) for pooling, eller **Session** (port 5432) om du foretrekker direkte tilkobling.

---

## 2. Kjør schema i databasen (én gang)

1. I Supabase-dashboardet: **SQL Editor** → **New query**.
2. Åpne filen `scripts/init-db.sql` i prosjektet og kopier hele innholdet.
3. Lim inn i SQL Editor og kjør (Run).
4. Sjekk at det ikke kommer feilmeldinger. Da er tabellene `users`, `sessions`, `admin_logs` og `plinko_stats` opprettet.

---

## 3. Sett miljøvariabelen DATABASE_URL

**Lokalt (PowerShell):**
```powershell
$env:DATABASE_URL = "postgresql://postgres.[ref]:[passord]@aws-0-[region].pooler.supabase.com:6543/postgres"
node server.js
```

**Lokalt (.env-fil, hvis du bruker f.eks. dotenv):**  
Lag en fil `.env` i prosjektroten (legg den i `.gitignore`):
```
DATABASE_URL=postgresql://postgres.xxx:yyy@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

**På server / hosting (Railway, Render, etc.):**  
Sett `DATABASE_URL` i miljøvariabler i dashboardet til tjenesten. Lim inn samme connection string.

### Render (steg for steg)

1. **Supabase:** Kjør `scripts/init-db.sql` i SQL Editor **før** du deployer (ellers får du "Deploy failed").
2. **Render:** Dashboard → ditt Web Service → **Environment**.
3. Legg til variabel: **Key:** `DATABASE_URL`, **Value:** lim inn Supabase connection string (URI fra Supabase → Project Settings → Database).
4. Bruk **Transaction** (port 6543) eller **Session** (port 5432) – begge fungerer.
5. Lagre og **Manual Deploy** (eller push til repo). Når deploy er grønn, skal nye registreringer vises i Supabase-tabellen **users**.

---

## 4. Start serveren

```bash
npm install
node server.js
```

Ved oppstart skal du se noe som:
- `Storage: database (DATABASE_URL)` når databasen brukes.
- Uten `DATABASE_URL` brukes fortsatt filer i `data/` (lokalt).

---

## 5. Verifiser at verdier havner i tabellen

1. **Registrer en bruker** på siden og spill litt (klikk, plinko, roulette).
2. I Supabase: **Table Editor** → velg tabellen **users**.  
   Du skal se rader med `username`, `balance`, `xp`, `level`, `game_net`, osv.
3. **sessions**: aktive innlogginger.  
4. **plinko_stats**: én rad (id = 1) med `total_balls` og `landings`.  
5. **admin_logs**: logger for admin-handlinger (roller, justeringer).

---

## Sikkerhet

- **Passord** lagres kun som bcrypt-hash i `users.password_hash`. De lagres aldri i klartekst.
- Ikke committ `DATABASE_URL` eller `.env` til git. Bruk miljøvariabler på server.
- I produksjon bruker appen SSL mot Supabase (`NODE_ENV=production`).

---

## Feilsøking

| Problem | Løsning |
|--------|--------|
| **Deploy failed / Exited with status 1** på Render | Åpne **Logs** i Render. Se etter «Startup failed» eller «Database startup failed». Vanligvis betyr det at tabellene mangler: kjør **hele** `scripts/init-db.sql` i Supabase SQL Editor, deretter ny deploy. Eller at `DATABASE_URL` mangler/er feil i Render → Environment. |
| "Database tables may not exist" | Kjør `scripts/init-db.sql` i Supabase SQL Editor. |
| "relation \"users\" does not exist" (eller plinko_stats) | Du har ikke kjørt schema. Kjør `scripts/init-db.sql` i Supabase → SQL Editor. |
| "Connection refused" / timeout | Sjekk at `DATABASE_URL` er riktig og at IP ikke er blokkert (Supabase: Settings → Database → Connection pooling / Network). |
| Ingen rader i `users` etter registrering | 1) Sjekk at deploy faktisk er grønn (ikke «Exited with status 1»). 2) I Render → Environment: sjekk at `DATABASE_URL` er satt. 3) I Logs ved oppstart: skal stå «Storage: database (DATABASE_URL)». 4) Registrer en ny bruker etter at DB er koblet på. |

Etter dette vil alle nye brukere og statistikk lagres i databasen, og deployer vil ikke slette eksisterende data.
