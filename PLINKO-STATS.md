# Plinko-statistikk API

Backend lagrer hvor mange baller som har landet i hver av de 18 slotene (pluss edge-fall).

## Hente Plinko-statistikk

### Offentlig endpoint (ingen auth)

```bash
curl http://localhost:3000/api/plinko-stats
```

**Eksempel-respons:**

```json
{
  "totalBalls": 1250,
  "slots": [
    { "slot": 0, "count": 45, "pct": "3.60%" },
    { "slot": 1, "count": 78, "pct": "6.24%" },
    { "slot": 2, "count": 112, "pct": "8.96%" },
    ...
    { "slot": 17, "count": 38, "pct": "3.04%" }
  ],
  "edgeCount": 12,
  "edgePct": "0.96%"
}
```

**Felt:**
- `totalBalls` – Totalt antall baller som har landet
- `slots` – Array med slot 0–17. Slot 0 og 17 er kantene (høy multiplikator), slot 8–9 er midten (lav multiplikator)
- `edgeCount` – Baller som falt utenfor (slot 18)
- `edgePct` – Andel baller som falt utenfor

### I nettleser

Åpne: `http://localhost:3000/api/plinko-stats`

### I JavaScript (fetch)

```javascript
const res = await fetch('http://localhost:3000/api/plinko-stats');
const data = await res.json();
console.log('Totalt baller:', data.totalBalls);
data.slots.forEach(s => {
  console.log(`Slot ${s.slot}: ${s.count} baller (${s.pct})`);
});
```

### Slot-indeks og multiplikatorer

Plinko har 18 slots (0–17). Slot-indeksen matcher plasseringen på brettet:
- Slot 0, 17: Kantene (høyest multiplikator, f.eks. 15×)
- Slot 8, 9: Midten (lavest multiplikator, f.eks. 1×)

Multiplikatorene varierer med risk level (low/medium/high/extreme).

## Admin-endpoint (krever nøkkel)

Hvis du har satt `ADMIN_RESET_KEY` i miljøvariabler:

```bash
curl "http://localhost:3000/api/admin/plinko-stats?key=DIN_ADMIN_NØKKEL"
```

Eller med header:

```bash
curl -H "x-admin-key: DIN_ADMIN_NØKKEL" http://localhost:3000/api/admin/plinko-stats
```

## Rådata (fil)

Statistikken lagres i `data/plinko-stats.json`:

```json
{
  "totalBalls": 1250,
  "landings": [45, 78, 112, 98, 85, 92, 105, 118, 125, 120, 108, 95, 88, 72, 65, 52, 41, 38, 12]
}
```

`landings[0]`–`landings[17]` = slot 0–17, `landings[18]` = edge (utenfor).
