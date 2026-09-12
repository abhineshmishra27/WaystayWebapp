# Cloudbeds channel-manager integration — status and handoff

Written 2026-09-06. Everything below is verified against the repo, not recalled.

**Branch:** `feat/channel-manager-integration` (26 commits, **not merged to `main`**)
**Tests:** 163 passing — 117 unit + 46 route
**Working tree:** `AGENTS.md`, `src/app/(customer)/dashboard/profile/page.tsx` and
`src/app/api/profile/route.ts` carry *your* in-progress edits. They were deliberately
never staged or committed. `src/app/api/profile/route.ts` still has 2 `console.error`
calls the logging sweep skipped for that reason.

---

## The one thing to know first

**Nothing has ever run against the real Cloudbeds API.** Method names are verified from
public docs, but the request/response *field names* are educated guesses — the detailed
schemas sit behind a partner login. Everything is validated against a fake that encodes
**the same guesses**, so agreement proves the pipeline is sound, not that the guesses are
right.

`postReservation`'s request shape is the least certain thing in the codebase (the
guest/room/adults arrays are inferred). Expect corrections concentrated in the
`normalise*` helpers and request builders in `src/lib/channels/cloudbeds.ts`. The
163-test suite will immediately tell you whether anything else moved.

**Blocked on:** a Cloudbeds developer application (client ID + secret) and a sandbox
property. This is the long pole and nothing downstream removes it.

---

## Will hotels actually show up?

Yes — proven end to end in `tests/routes/channel-visibility.test.mts` — but **not
automatically**:

1. Connect a property at `/admin/channels` (admin picks which OWNER the hotels belong to)
2. Click Import — creates the hotel, rooms, mappings, slots and holds
3. **An admin must approve the hotel** under Hotels before it appears in search

Step 3 is a deliberate gate: third-party inventory does not publish itself. "Connected but
nothing appeared" is expected behaviour, not a bug. Say so if you'd rather it auto-publish.

Imported hotels are **night-only** (no hourly slots), priced from the rate plan, drop out
of search when the channel sells every unit for a night, and return when the hold clears.
Photographs are re-hosted to Cloudinary at import so listings are not blank.

---

## Phase status

| Phase | State |
|---|---|
| A1 slot-horizon cron | Done |
| A2 route-test harness | Done |
| A3 logger redaction | Done |
| B OAuth + admin API + `/admin/channels` | Done, unvalidated against real API |
| C reconciliation cron + webhook + drift detection | Done, unvalidated against real API |
| D push bookings + cancellations back | Done, unvalidated against real API |
| **E provisional holds before payment** | **Not started** |
| P1 search bounding + indexes | Done |
| P2 slot retention | Done |
| P3 image re-hosting | Done |
| P4 payment/booking guards | Done |
| P5 observability | Logger + health + sweep done; **error tracking and wider route tests still open** |

---

## Environment variables still missing from `.env.local`

Imports and OAuth **cannot run** without these. All are documented in `.env.example`.

```
CHANNEL_CREDENTIALS_KEY          # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
CLOUDBEDS_CLIENT_ID              # from the Cloudbeds developer application
CLOUDBEDS_CLIENT_SECRET
CLOUDBEDS_REDIRECT_URI           # e.g. http://localhost:3001/api/channels/cloudbeds/callback
CLOUDBEDS_WEBHOOK_PATH_SECRET    # long random; the webhook URL IS the credential
```

Already present and working: `NEON_API_KEY` (route tests), `WAYSTAY_NEON_PROJECT_ID`,
`CLOUDINARY_*`, `CRON_SECRET`, Razorpay test keys.

Register with Cloudbeds: the redirect URI exactly as written, and the webhook endpoint as
`/api/channels/cloudbeds/webhook/<CLOUDBEDS_WEBHOOK_PATH_SECRET>`.

---

## Open work, in the order I would do it

1. **Get the Cloudbeds sandbox and validate B, C and D against it.** Everything else
   stacks on unverified assumptions. Expect field-name fixes in `cloudbeds.ts`.
2. **Phase E — provisional holds.** The push currently happens *after* payment succeeds,
   so a window remains where a guest has paid and the channel does not know. E places a
   hold when the booking row is created (still PENDING, before money moves), confirms on
   success, releases on failure or expiry.
3. **Error tracking (P5).** `logger.ts`'s `emit` is the single place that would forward to
   Sentry or similar. A cron failing at 3am against a third-party API is exactly what
   nobody sees in stdout today.
4. **Downgrade business rejections from `error` to `info`/`warn`.** "Not enough rooms",
   "requires online payment" and similar 4xx paths log at error level. Harmless now; they
   will generate false alerts the moment error tracking exists.
5. **Wider route-test coverage.** The harness exists; only bookings and channel flows use
   it. Search and the crons are still untested at route level.

### Smaller known gaps

- `prisma.location.findMany()` in search is unbounded (14 rows today; needs a recursive
  CTE to fix properly).
- Pagination is still a JavaScript `slice` over a 300-hotel pool. Documented trade-off —
  real SQL pagination needs the relevance score materialised.
- Prune cron caps at 100k rows per run and reports `more: true`, which nothing acts on.
- `/api/health` is unauthenticated (exposes uptime and DB latency only).
- ~40 stray `*.log` files in the repo root are untracked and could be gitignored.
- Two servers the user was running (ports 3001, 3017) went down mid-session and were not
  restarted.

---

## Architecture, and why it is shaped this way

**`src/lib/channels/`** — the boundary that keeps a second provider additive:
`cloudbeds.ts` speaks HTTP and Cloudbeds payloads and never touches Prisma; `mapping.ts`
is pure translation; `sync.ts` owns transactions and knows nothing about any wire format.
`types.ts` holds the `ChannelAdapter` contract. Also `credentials.ts` (token lifecycle),
`crypto.ts` (AES-256-GCM), `oauth-state.ts` (signed state), `images.ts` (Cloudinary
re-hosting).

**Invariants that must not be broken:**

- **No external HTTP inside a `prisma.$transaction`.** Holding row locks across network
  I/O turns a slow partner into a database outage.
- **Availability writes take `lockRoomInventory`** — the same advisory lock the booking
  path uses — so sync cannot race a customer mid-checkout.
- **`RoomSlot.isBooked` does NOT gate capacity.** Capacity is counted from active
  `Booking` rows against `Room.inventoryCount`. This is why channel inventory blocks sales
  through `ChannelInventoryHold`, which `requestHasCapacity` subtracts. Setting `isBooked`
  would have been a silent no-op.
- **Webhooks are untrusted hints, never state.** Cloudbeds signs nothing and does not
  guarantee ordering, so the receiver re-reads authoritative state from the API. A forged
  payload can at worst cause a needless re-read; it can never write attacker-chosen values.
- **Idempotency keys are natural, never generated:** `thirdPartyIdentifier` = booking id;
  `ChannelSyncLog.eventKey` for webhooks; upserts on `(connectionId, externalRoomTypeId)`
  and `(roomId, date)`.
- **A failed push never costs a guest their booking.** They have paid. It is recorded,
  retried with backoff, and abandoned after 6 attempts for a human.

**Two kill switches:** `CHANNELS_ENABLED=false` globally, `ChannelConnection.syncEnabled`
per connection.

---

## Running things

```bash
npm run test:routes        # ~2 min, creates and destroys a Neon branch per run
npm run test:channel-holds # and the other test:* scripts, all fast and offline
npx tsc --noEmit
npx eslint src/ tests/
```

Route tests need `NEON_API_KEY`. They create a throwaway branch named `test-<ts>-<rand>`,
truncate it, seed fixtures and delete it afterwards. **They never touch the dev database.**
If a run crashes, delete stray `test-*` branches at console.neon.tech.

`tests/support/` holds the harness: `neon-branch.mjs`, `route-harness.mts`,
`cloudbeds-fake.mjs` (stand-in API), `auth-stub.mts`, `cloudinary-stub.mts`, and
`alias-hook.mjs` (resolves `@/*`, `next/server`, and swaps stubs behind
`WAYSTAY_TEST_STUBS=1`).

**Caution:** `git add -A` sweeps in the user's uncommitted profile edits. Stage explicitly.

---

## Incidents from this session, and what they taught

- **A long-running `next start` wedged twice**, every query failing while the database was
  healthy. Root cause never established; failures returned in ~20ms, too fast for a
  timeout. Connection-pool bounds were added (`32cedf1`) and did *not* prevent the second
  occurrence, so that explanation is incomplete. `/api/health` now distinguishes app from
  database in one request, and port 3001 logs to `server-3001.log`. **If it recurs, leave
  it broken and read that log.**
- **Dead Supabase URLs** in `.env`/`.env.local` had five scripts pointing at a
  decommissioned database. Fixed by routing every script through
  `scripts/database-url.js`.
- **`prisma migrate diff` wanted to drop the PostGIS and pg_trgm indexes** and the
  `geoPoint` generated column, because they live in hand-written migrations Prisma cannot
  express. The migration in `20260905130000_add_channel_connections` is hand-edited and
  says so at the top. **Do not regenerate it blindly.**
- **`generateSlotsForRoom` defaults do not match reality** — same-day `08:00→20:00` full
  day versus the actual overnight `12:00→11:00`, and it emits `H9` rows no room can sell.
  The horizon cron extends each room's *own* pattern for this reason.
