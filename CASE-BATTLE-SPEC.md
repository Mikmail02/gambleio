# Case Battle – Spec & Architecture

## 1. Admin Case Creator (Math)

- **Items:** Each has `value` ($V$) and `probability` ($P$). Probabilities must sum to **100%** (validated with tolerance `1e-4`).
- **Expected Value:** \( EV = \sum (P_i \cdot V_i) \).
- **Case Price:** \( Price = EV / RTP \). RTP is configurable (e.g. 0.95 = 95%).
- **Implementation:** `lib/case-battle-math.js` → `calculateCasePrice(items, rtpDecimal)` returns `{ success, price, ev }` or `{ success: false, error }`.

---

## 2. Battle Formats & Case Selection

**Formats (slots per side):** 1v1, 1v1v1, 1v1v1v1, 1v1v1v1v1, 1v1v1v1v1v1, 2v2, 2v2v2, 3v3. Validated via `isAllowedFormat(slotsPerSide)`.

**Case selection:** Creator adds cases with multiplicities (e.g. 3× Case A, 1× Case B). **Total entry cost** = sum over (case price × count) for each case in the lobby. Each participant pays the same total entry.

---

## 3. Game Modes & Winner Logic

Implemented in `resolveBattleResult(participants, totalPot, mode)` and for Jackpot `resolveJackpotWinner(teamTotals, totalPotValue, roll01)`.

| Mode | Rule |
|------|------|
| **Standard** | Highest **total value** (all opened items) wins the entire pot. |
| **Terminal** | Only the **last** case’s value counts per participant. Highest terminal value wins the pot. |
| **Co-op** | No winner; everyone splits the total pot equally. |
| **Crazy (standard)** | **Lowest** total value wins the pot. |
| **Crazy (terminal)** | **Lowest** terminal (last case) value wins the pot. |
| **Jackpot** | Each team’s total item value = ticket weight. Win chance = (team value) / (total value of all items). One provably fair roll in [0, 1) picks the winner; that team takes the whole pot. |

Ties (same best value in Standard/Terminal/Crazy): pot split equally among all participants.

---

## 4. Database Schema (PostgreSQL)

- **case_battle_cases** – id, name, slug, rtp_decimal, price, expected_value, created_at, created_by, is_active.
- **case_battle_items** – id, case_id, name, value, probability, sort_order. Sum of probability per case_id = 1.
- **case_battle_battles** – id (UUID), format, mode, total_pot, status (waiting | in_progress | finished), server_seed_hex, client_seed, nonce, created_at, started_at, finished_at, winner_team_index, meta.
- **case_battle_battle_cases** – battle_id, case_id, count (how many of that case in this battle).
- **case_battle_participants** – battle_id, team_index, slot_index, username, entry_paid, total_value, terminal_value, payout, joined_at.
- **case_battle_rounds** – battle_id, participant_id, case_id, round_order, item_id, item_value, opened_at. One row per case open; order defines “last case” for Terminal/Crazy terminal.

See `scripts/init-case-battle.sql`.

---

## 5. UI / Battle Arena Layout

**Dynamic grid by format:**

- **1v1:** 2 slots in a row or column (e.g. left vs right).
- **1v1v1 … 1v1v1v1v1v1:** 3–6 slots in a row (or 2 rows for 5–6).
- **2v2:** 2 columns, 2 rows (team A left, team B right).
- **2v2v2:** 3 columns, 2 rows (team A, B, C).
- **3v3:** 2 columns, 3 rows per side (e.g. 2 columns × 3 rows = 6 slots).

**Suggested structure:**

1. **BattleArenaContainer** – holds format + list of participant slots.
2. **ParticipantSlot** – avatar, username, “cases” strip (N case icons), total/terminal value, highlight if winner.
3. **CaseStrip** – for each participant: one block per case in the battle (e.g. 3× Case A, 1× Case B → 4 blocks). Each block shows closed → open with item image/value when revealed.
4. **ResultBanner** – winner name / “Tie” / “Jackpot: Team X wins” and pot split.

**Layout mapping (example):**

- `1v1` → `grid-template-columns: 1fr 1fr;` (2 cells).
- `1v1v1` → `grid-template-columns: repeat(3, 1fr);`.
- `2v2` → `grid-template-columns: 1fr 1fr; grid-template-rows: auto auto;` with team labels.
- `3v3` → 2 columns × 3 rows; each column = one team.

Use `format` from battle to derive `columns` and `rows` and render slots in a CSS Grid or flex wrap.

---

## 6. Provably Fair (Multiplayer)

**Flow:**

1. **Before battle:** Server generates **server seed** (random 32 bytes, hex). Stored with battle, not sent to clients until battle is finished.
2. **Battle creation or join:** **Client seed** = optional player input or server-generated; stored with battle. **Nonce** = 0 (or increment per battle for same seeds).
3. **On battle end (Jackpot):**  
   - Total pot value = sum of all opened item values.  
   - Per-team weights = team total value.  
   - Roll: `roll01 = provablyFair.roll01(serverSeed, clientSeed, nonce)`.  
   - Winner = team whose cumulative bucket contains `roll01` (see `resolveJackpotWinner`).
4. **Reveal:** After battle, server sends `serverSeed`, `clientSeed`, `nonce`, and the hash of the round (e.g. HMAC-SHA256(serverSeed, clientSeed + ':' + nonce)). Clients can recompute the hash and `hexToFloat01` to verify the roll.

**Trust:** All participants get the same revealed seeds and nonce after the round; they can verify that the single roll in [0, 1) was derived from those values and that the winner index matches the buckets. No need for per-player seeds for a single shared Jackpot roll.

**Implementation:** `lib/case-battle-provably-fair.js` – `generateServerSeed()`, `roll01(serverSeed, clientSeed, nonce)`, `getProof(...)` for verification payload.

---

## 7. Flow Summary

1. **Admin:** Create case (items + RTP) → validate probabilities → `calculateCasePrice` → save case and items to DB.
2. **Creator:** Create lobby (format, mode, list of case_id + count) → compute total entry = sum(price × count) → create battle row + battle_cases rows; status = waiting.
3. **Join:** User joins a slot; deduct entry from balance; when all slots full, set status = in_progress, set server_seed, start_at.
4. **Opening:** For each participant × each of their cases (in round_order), open one random item from the case (weighted by probability), insert round row, update participant total_value and terminal_value (last case only for terminal).
5. **Resolve:**  
   - Standard/Terminal/Crazy: `resolveBattleResult(participants, totalPot, mode)` → winner_team_index, payouts; credit payouts to participants.  
   - Jackpot: `resolveJackpotWinner(teamTotals, totalPotValue, roll01(...))` → winner team; credit full pot to that team’s participants.  
6. **Reveal:** status = finished, finished_at, reveal server_seed (and client_seed, nonce) for provably fair verification.
