# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

A habit tracker built on Expo + React Native, running on iOS, Android, and web from one codebase.

It is deliberately structured around a product framework — keep changes inside it rather than bolting features on:

| Layer | Where it lives |
|---|---|
| **Core function** — create and track habits | `lib/habits.ts`, Today screen |
| **Core loop** — every check-in rewards | `lib/feedback.ts` (haptics + sound), `components/celebration.tsx` (visual) |
| **Challenge** — fixed-length commitment with a payoff | `lib/challenges.ts`, Challenge screen |
| **Accessory** — logging and consistency | Insights screen, `components/consistency-chart.tsx` |
| **Retention** — daily nudges | `lib/notifications.ts`, Settings screen |

**Surface-area budget: 5–7 screens, and it currently sits at 7** (4 tabs + onboarding + the new-habit modal + the sign-in modal). **The budget is now full** — an eighth screen means merging something first, not just deciding to add one.

The seventh was spent deliberately on `sign-in.tsx`: signing in has its own error, validation and email-confirmation states, and folding those into Settings would have made the longest screen in the app longer still.

Two things deliberately avoid spending that budget: `new-habit.tsx` doubles as the **edit** screen via `?id=`, and the developer tools live in a `__DEV__`-gated section of Settings rather than their own screen.

## Expo SDK 54 is pinned deliberately — do not upgrade

The project was moved down from SDK 57 to **SDK 54** because the target iPhone's Expo Go supports SDK 54 and cannot be updated further (iOS version cap). Running `npx expo install --fix` against a newer `expo` package, or bumping `expo` in `package.json`, will silently break the only way this app gets onto the device.

Consult the **v54** docs (`https://docs.expo.dev/versions/v54.0.0/`), not the latest. SDK 57 APIs that are absent in 54 and were already removed once here:

- `ThemeProvider` / `DarkTheme` / `DefaultTheme` come from `@react-navigation/native`, not from `expo-router`.
- Navigation uses the standard `Tabs` navigator from `expo-router`. The `expo-router/unstable-native-tabs` API differs between 54 and 57 — avoid it.
- `useColorScheme()` returns `'light' | 'dark' | null | undefined`. There is no `'unspecified'` value (that is RN 0.86 / SDK 57).
- `eslint-config-expo` is v10 here; rules from newer configs (e.g. `react-hooks/set-state-in-effect`) do not exist and an `eslint-disable` naming one is itself a lint error.

## Commands

```bash
npm run web        # dev server + web preview (also serves the native manifest on :8081)
npm run ios        # dev server, opens iOS target
npm run android    # dev server, opens Android target
npm run lint       # eslint via expo lint
npm run test:parity # cross-checks src/lib/habits.ts against the Edge Function copy
npx tsc --noEmit   # typecheck — not part of lint, run it separately
npx expo-doctor    # dependency/config health check
```

There is **no test framework configured** — no `test` script, no Jest. Verification is typecheck + lint + running the app.

`.claude/launch.json` defines the `expo-web` server for `preview_start`. Only one entry exists because Expo serves every platform from a single Metro instance on port 8081; `ios`/`android` are native targets, not browser-previewable.

### Running on a physical device

Expo Go connects over `exp://<mac-lan-ip>:8081`. The LAN IP changes on DHCP renewal, and a stale IP shows up as "Unknown error: The request timed out" in Expo Go. Get the current one with `ipconfig getifaddr en0`, or use `npx expo start --tunnel` for an address that survives IP changes.

## Architecture

Data flows in one direction: pure logic → context → screens.

- **`src/lib/`** — pure functions, no React and no storage. `habits.ts` (day keys, streaks, rates, seed), `challenges.ts` (fixed-length commitments). `feedback.ts` and `notifications.ts` are side-effecting but stateless. Change behavior here, not in screens.
- **`src/hooks/use-habits.tsx`** — the only stateful layer. Holds `{ habits, challenge, settings }`, persists to AsyncStorage under `habit-tracker.state.v3`, and owns the migration chain from v2 and v1 (see "Storage migrations" below). Its `loading` flag guards the first write so an empty state can't overwrite stored data before the read settles.
- **`src/app/`** — expo-router. Root `_layout.tsx` is a Stack (tab group + onboarding + modal); `(tabs)/_layout.tsx` holds the tab bar and gates on onboarding.

Screens are stateless with respect to habits — they read `useHabits()` and call lib helpers. Nothing computes streaks or dates inline.

### Domain rules worth knowing

- Day keys are local-time `YYYY-MM-DD`, never UTC — "today" means the user's today. `addDays` rebuilds dates from parts so DST cannot shift a day.
- An incomplete *today* does not break a streak: `streak()` falls back to counting from yesterday, since the day isn't over. Changing this changes what every streak in the app means.
- **Two habit kinds share one log shape.** `log` is `dayKey -> count`; `binary` habits are just `target: 1`. Nothing downstream branches on kind — never add a parallel code path for one kind.
- `logStep()` wraps a count habit back to zero once it passes its target, so a mis-tap is always a few taps from correct rather than stuck.
- **The challenge resolves exactly once**, on the tap that fulfils its final day — that transition is what fires the big celebration. Don't move fulfilment detection into render.

### Supabase, auth and sync

The database is a **sync target, not the source of truth**. AsyncStorage is what
the screens render from; a check-in tap writes local state and returns in the
same frame. Nothing in a mutation path may ever `await` the network — that is
the core loop, and a spinner on a check-in destroys it.

- **`src/lib/supabase.ts`** exports a client that is **`null` when
  `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` are unset.** With
  no credentials the entire remote layer sits out and the app behaves exactly as
  it did before the database existed. Keep it that way — it's what keeps the web
  preview and a fresh clone usable.
- **`web.output` is `"static"`, so every route is prerendered in Node, where
  there is no `window`.** AsyncStorage's web build reads `window.localStorage`
  directly and supabase-js touches storage while *constructing* the client, so
  handing it AsyncStorage during the prerender crashes the dev server on boot,
  before any route renders. `supabase.ts` guards this with `prerendering`. Any
  new module that touches storage at import time needs the same guard.
- **`src/lib/sync.ts` merge rule: remote is authoritative except where a pending
  local op exists.** `state.pending` holds exactly the edits this device hasn't
  pushed; anything not in it has already been pushed, so a newer remote value
  must have come from another device. That is what buys last-write-wins without
  stamping every habit and every day-cell with its own `updatedAt` — and without
  the log ever changing shape.
- **Deletes are tombstones** (`deletedAt`), never array removals. A hard delete
  has no `updated_at` for a delta pull to find, so the row is resurrected by the
  next pull from a device that still has it. `useHabits()` filters tombstones
  out, so screens never see one — but `rescheduleReminders` must be given the
  filtered list or a deleted habit keeps notifying.
- **A check-in of zero is stored as `count = 0`, not a deleted row**, for the
  same reason: undoing a check-in has to be able to reach the other device.
  Zero maps back to an absent key in the log, so `logStep` round-trips exactly.
- **Ids are client-generated UUIDs** (`lib/ids.ts`). A habit created offline
  needs its id immediately, and the old `seed-0` / `Date.now()` scheme collided
  across users the moment rows shared a table.
- **First contact with an account adopts or claims, never merges.** If the
  account already has habits, the device adopts them wholesale; if it's empty,
  the device pushes everything up. Merging the two grafts demo seed data onto a
  real account.
- **RLS is the access control**, not app code. Every table carries `user_id` and
  one `auth.uid() = user_id` policy. The anon key ships inside the bundle by
  design; it is the policies that keep one user out of another's rows. The
  service role key bypasses RLS entirely and must never appear under `src/`.
- **On web the session lives in `localStorage`, and what makes that safe is
  enforced by lint.** AsyncStorage's web build is `window.localStorage`, so the
  refresh token is readable by any script on the origin; httpOnly cookies would
  need `@supabase/ssr` and a server session route, and `web.output` is
  `"static"`, so there is no server to host one (see the long note in
  `supabase.ts`). The reason it's acceptable is that the XSS surface is empty by
  construction — everything renders through `<ThemedText>` → RN `<Text>`, which
  escapes. That is a property of the current code rather than of the storage
  choice, so `eslint.config.js` fails the build on `dangerouslySetInnerHTML`,
  `innerHTML`/`outerHTML`/`insertAdjacentHTML`, `eval`, and `new Function`
  anywhere under `src/`. Don't disable those rules to ship a feature; the
  refresh token is what's on the other side of them.
- **Auth policy lives in the dashboard, and `config.toml` only mirrors it.**
  The committed values are 10-character passwords with
  `lower_upper_letters_digits`, email confirmations on, and a **600-second** OTP
  expiry. That last one matters: the recovery code is six digits, and redeeming
  one yields a *session* (`resetPassword` signs the user in, then sets the
  password). Per-IP verification limits make a single-host attack hopeless but
  do nothing against a distributed one — the validity window is what bounds
  that. `sign-in.tsx` restates the length minimum for inline validation, so the
  two have to move together or a password the user is told is fine comes back
  rejected.

Setup lives in `.env.example`; the schema is one file, `supabase/migrations/0001_init.sql`.

### AI coaching and reflections

Two features, both **Claude Sonnet 5 via a Supabase Edge Function**, never from
the app: `coach` (a daily nudge on Today) and `reflect` (a weekly report on
Insights). Neither spends a screen — they render as cards inside surfaces that
already exist, because the budget is full.

- **`ANTHROPIC_API_KEY` is an Edge Function secret and must never become an
  `EXPO_PUBLIC_` variable.** Anything `EXPO_PUBLIC_` is inlined into the bundle
  and readable by anyone who downloads the app. The whole reason these features
  are server-side is to keep that key off the device — the anon key is
  publishable, this one is not.
- **The functions authenticate as the caller, not the service role.** They
  forward the request's JWT into `createClient`, so RLS filters every query they
  make. A bug in a function still cannot read another user's habits, because the
  database won't return them.
- **Arithmetic in code, judgment in Claude.** `_shared/stats.ts` computes every
  streak, rate, and total; the model only ever sees finished numbers and is told
  not to derive new ones. A model counting check-in rows is slower, costlier,
  and occasionally wrong.
- **`_shared/stats.ts` is a second copy of the rules in `src/lib/habits.ts`** —
  Edge Functions run on Deno and `habits.ts` reaches `expo-crypto`, which has no
  Deno build. The copies are pinned by **`npm run test:parity`**, which runs both
  over identical randomised histories and fails if they disagree. Run it after
  touching either file — it is the only thing stopping the two from drifting.
  (`scripts/parity/` stubs `expo-crypto` so the app module imports under Node.)
- **The client sends its own `today` — but it is bounded, not just well-formed.**
  Functions run in UTC, so they must never decide what the user's local day is;
  for anyone east of UTC in the evening the server's date is already tomorrow.
  They validate it with **`isPlausibleToday`**, not `isDayKey`: ±2 days from the
  server's date, which covers UTC-12..UTC+14 plus a slow device clock. This is
  load bearing, because the throttle below is keyed on that value — a shape-only
  check makes the cache key caller-chosen and every request a fresh billed model
  call. `scripts/parity/` guards the bound; don't loosen it back to `isDayKey`.
- **Throttling is a unique constraint, not app code.** One coach note per
  `(user, day)`, one reflection per `(user, period, period_start)`. A double-tap
  or two devices racing therefore cannot produce two billed model calls; the
  loser re-reads the winner's row.
- **The cache tables are read-mostly, and that is what makes the throttle a
  spend limit.** `0004_lock_ai_cache.sql` revokes DELETE on `coach_messages` and
  `reflections` from `authenticated`, and narrows UPDATE to a column-level grant
  on `dismissed_at`. A user who can delete their own cached row can clear the
  throttle and re-bill in a loop, which is why the client-side `devClear*`
  helpers are gone — force a regeneration from the dashboard instead. INSERT
  deliberately stays: `coach` and `reflect` write as the calling user.
- **Three things bound spend, and they guard different axes.** The throttle
  caps *how many* calls an account makes; it did nothing about how large each
  one was, or how many accounts existed. `0007_bound_ai_spend.sql` closes both.
  - **Size.** `habits.name`/`challenges.name` are capped at 80 characters and
    `habits.emoji` at 64, with a trigger capping active habits at 100 per
    account; both AI functions additionally `.limit(100)` the habits query.
    Every habit's name and emoji is copied verbatim into the snapshot the model
    reads, so an unbounded column was an unbounded billed input — 400 habits
    with 20 KB names is ~2M tokens inside one *legitimate* cache miss. The
    constraint is the control, not the `maxLength` on the TextInput: PostgREST
    is the real entry point, and RLS happily lets a user write their own rows.
  - **Accounts.** The throttle key is `(user_id, day)`, so a fresh account is a
    fresh quota and free signup was the amplification path. **Email
    confirmation is what makes an account cost something** — every account now
    needs a real, deliverable mailbox before it can sign in. Behind it, both
    functions require `MIN_ACTIVE_DAYS` (3) of real check-ins before
    generating; a scripted account can insert check-in rows too, so that raises
    the cost rather than closing the door. **Captcha would be the strongest
    control here and is deliberately still off** — enabling it makes Supabase
    demand a `captchaToken` that `use-auth.tsx` doesn't send, so it breaks
    sign-up until someone builds the widget (a WebView on native). See the note
    in `config.toml`; don't flip it without the client work.
  - **A ceiling.** A claim is reserved *before* the call is made (a failed call
    may still bill) and refused past 25/user/day or 500/project/day — tune via
    `ai_daily_user_limit()` / `ai_daily_global_limit()`. Two functions, not
    one: `claim_ai_generation(kind)` takes no user id and derives identity from
    `auth.uid()` (granted to `authenticated`), while
    `claim_ai_generation_for(user_id, kind)` takes one and is granted only to
    `service_role`, because `coach-cadence` has no session. Keep that split —
    a single function has to skip its own identity check when `auth.uid()` is
    null, which makes "no identity" mean "trust the parameter".
    **The global cap is a deliberate tradeoff: it converts unbounded spend into
    a denial of service that anyone with enough accounts can trigger.** That is
    the better failure of the two, but with captcha off it is the *only* thing
    bounding the bill, so raise it deliberately as real usage grows rather than
    discovering it as an outage. A refused claim degrades exactly like no
    network: no card, no error. `coach-cadence` reports `declined` so a cap
    engaging is visible in the run log rather than silent.
- **Cache before generate.** Both functions return the stored row on a hit and
  only call Claude on a miss, so reopening a screen costs an indexed SELECT.
  The order inside a miss is load-bearing: cache → history threshold → claim →
  model → store. Claiming after the model call would bill without accounting.
- **Reflections cover the last *completed* period**, not a trailing window — a
  moving window would make the throttle key change daily and let one "weekly"
  report generate every day.
- Nothing here may be awaited from a check-in. `src/lib/coach.ts` returns `null`
  on every failure rather than throwing, so with no project, no account, or no
  network the cards simply don't render and the app behaves as it did before.

- **Required secrets are read at module load** (`_shared/env.ts`), so a deploy
  that forgot one fails in the deploy log. Lazily discovering it meant a 502
  that `lib/coach.ts` swallows into `null` — a card that silently doesn't
  render, which is this project's recurring failure mode. `CRON_SECRET` is the
  deliberate exception: it stays a per-request check so an unauthenticated
  probe gets a 401 rather than a 500 confirming the deployment is broken.
- **CORS is an allowlist, not a wildcard** (`_shared/http.ts`). Only the web
  build needs CORS at all — native clients send no `Origin`. Add preview
  origins via the `EXTRA_CORS_ORIGINS` secret (comma-separated) rather than
  editing the file. Responses are built through `respond(req)` so there is no
  longer a way to emit one that forgot its origin handling.

Deploy with `npx supabase functions deploy coach reflect`; set the key with
`npx supabase secrets set ANTHROPIC_API_KEY=...`. Both need a linked project.

**`coach`'s prompt and cache-then-generate logic live in
`_shared/coach-generate.ts`**, not in `coach/index.ts` itself — `coach/index.ts`
is just the HTTP boundary (authenticate, validate `today`, hand off). This is
what lets `coach-cadence` (below) reuse the identical prompt instead of a second
copy that could drift, the same reasoning as the `stats.ts` duplication note
above, just for prose instead of arithmetic.

**`coach-cadence` generates each user's note proactively**, once their local
morning arrives, instead of only reactively on first open — an hourly sweep
(scheduled via pg_cron; see the project's Supabase SQL editor for the
`cron.schedule` call) that checks each profile's stored `timezone` against the
current hour in that zone and calls the same `getOrGenerateCoachNote` the
on-demand path uses. The on-demand path stays as a fallback — anyone the sweep
hasn't reached yet (new signup, no timezone synced) still gets a note the
moment they open the app, exactly as before this existed.

**The sweep has two dependencies outside this repo, and both were broken once.**
The cron job lives in the database, not in a migration, because its command
embeds `CRON_SECRET`. That puts it outside code review, which is how it sat
failing every hour with nobody noticing — the on-demand fallback is good enough
that a dead sweep is invisible from the app. Check both when it misbehaves:

> **Pending, and the one item the audit could not fix from the repo:** that
> command stores `CRON_SECRET` in cleartext in `cron.job.command`, where anyone
> with SQL or dashboard read access can `select command from cron.job` and
> recover the only gate in front of a `verify_jwt = false`, service-role
> function. `cron` is not in `[api].schemas`, so PostgREST does not expose it —
> this is privilege escalation from read access, not remote exploitation. Move
> it into Vault and **rotate afterwards**, since the old value has been sitting
> there readable:
>
> ```sql
> select vault.create_secret('<new-secret>', 'cron_secret');
>
> select cron.alter_job(
>   (select jobid from cron.job where jobname = 'coach-cadence'),
>   command := $$
>     select net.http_post(
>       url     := 'https://<project-ref>.supabase.co/functions/v1/coach-cadence',
>       headers := jsonb_build_object(
>         'Content-Type',  'application/json',
>         'Authorization', 'Bearer ' || (
>           select decrypted_secret from vault.decrypted_secrets
>           where name = 'cron_secret'
>         )
>       )
>     );
>   $$
> );
> ```
>
> Then `npx supabase secrets set CRON_SECRET=<new-secret>` so the function and
> the job agree.

- **`pg_net` must be installed** (`0006_pg_net.sql`). The job calls
  `net.http_post`; without the extension every run fails with `schema "net"
  does not exist`. `cron.job_run_details` is where that shows up, and it is the
  only place it shows up.
- **The URL must match the real project ref.** It was once a near-miss typo
  that resolved to NXDOMAIN. `net.http_post` is *async*, so a bad host still
  records the cron job as `succeeded` — the HTTP outcome lands in
  `net._http_response`, not in `cron.job_run_details`. Check both tables, or a
  DNS failure reads as a healthy job.

- **This is the one function that runs as no one.** A cron tick isn't a
  signed-in user, so `coach-cadence` can't authenticate as a caller and ride
  RLS the way every other function does — it checks a dedicated `CRON_SECRET`
  header instead and reads with the service-role client. That key must never
  reach `src/`, same as everywhere else; the difference here is that this one
  function is deliberately allowed to hold it, because there's no JWT to hold
  instead. Every query it makes is still scoped to one `user_id` explicitly
  (see `getOrGenerateCoachNote`) — the elevated client widens reach across
  accounts, not what any single call can touch.
- **It resolves that key across both of Supabase's key systems**, preferring
  the newer `SUPABASE_SECRET_KEYS` (a JSON dictionary of `sb_secret_...` keys,
  `default` being the project's own) and falling back to the legacy
  `SUPABASE_SERVICE_ROLE_KEY` JWT. Legacy keys are deprecated end of 2026 and
  are revoked *wholesale* when they're switched off in the dashboard, so a
  function that only reads the legacy variable dies silently on that switch —
  silently because the on-demand path in `coach` covers for a dead sweep. The
  200 body reports `keySource` (`secret_keys` or `legacy_jwt`, never the key)
  so which system is actually in use is visible from the scheduler's log
  *before* the switch rather than after. Don't drop the fallback until that
  reads `secret_keys`.
- **`verify_jwt = false` in `config.toml` for this function only.** Supabase's
  Edge Function gateway requires a valid JWT or project key in `Authorization`
  before a request reaches function code at all, by default — a cron job has
  neither, so the platform-level check has to be turned off here for the
  function's own `CRON_SECRET` check to ever run. Every other function keeps
  the default on. Because that header is the only gate in front of every user's
  data, it is compared with `timingSafeEqual`, the function is **POST only**,
  and it sends no CORS headers — a scheduler is not a browser. Point the
  `cron.schedule` call at `net.http_post`, and keep `CRON_SECRET` at
  `openssl rand -base64 32` strength.
- **Client timezone lives on `profiles.timezone`**, captured once from
  `Intl.DateTimeFormat().resolvedOptions().timeZone` after storage loads (see
  the effect in `use-habits.tsx`) and pushed through the same settings sync
  path as `sound`/`haptics`. Nullable and additive — a user who hasn't synced
  it yet is simply skipped by the sweep, not blocked from anything.
  **It is bounded by `0008_bound_timezone.sql`** (64 chars, IANA shape), for
  the same reason 0007 bounds `habits.name`: it is user-writable straight
  through PostgREST, and the sweep reads it across *every* account into one
  function's memory. An unbounded column there is one user degrading the sweep
  for all of them — invisibly, because the on-demand path covers for it.
  `use-habits.tsx` mirrors the bound and skips a value that wouldn't pass, so a
  rejected upsert can't leave a settings op pending forever; the two move
  together. All 417 zones `Intl` knows fit, the longest being 30 characters.
- **Push notifications were scoped out deliberately, not forgotten.** Real
  push needs a development build — Expo Go dropped support for remote push —
  so wiring push tokens and a send pipeline was deferred until that's worth
  doing. If it comes back: the two-notes decision (a distinct, shorter
  afternoon nudge rather than re-sending the morning note) was already made.

### Storage migrations

`use-habits.tsx` reads `habit-tracker.state.v3`, falling back to v2 (`migrateV2()`, which re-issues every id as a UUID and remaps the challenge's `habitId` through the same table) and then to v1 (`migrateV1()`). Old keys are left in place rather than deleted — users have real history on device, and a bad migration should be recoverable. Reseeding silently destroys it. Two cases:

- **Additive fields** (a new nullable property) are filled in by `normalize()` on read. Nothing already stored is reinterpreted, so the key stays.
- **Anything that reinterprets existing data** needs a new key plus another forward-read, like v1 → v2 did.

### Feedback and notifications

- `feedback.ts` keeps audio players alive for the session; creating one per tap adds latency that visibly decouples the reward from the press. Sound respects the device silent switch by design.
- Reminders are **local scheduled** notifications, which is why they work in Expo Go. Remote push would need a development build. `rescheduleReminders()` rebuilds the whole schedule rather than diffing it.
- **Reminder times live on the habit** (`habit.reminderTime`, local `HH:MM` or null), not in settings. Settings holds only the master on/off. One notification is scheduled per habit that has a time.
- Both degrade on web: haptics no-op and notifications never fire. Settings still shows and saves the times there, with a note, so the config is testable in the browser preview.

### Colour rules that are not cosmetic

**Never hardcode `#ffffff` for text on `accent`.** Dark mode's accent is a *light* blue, where white measures 2.69:1 and reads as invisible — this shipped once and had to be fixed everywhere. Use `themeColor="onAccent"`, which is white in light mode and near-black in dark.

**Never disable a button with blanket `opacity`.** Fading the surface and its label together is what made "Add habit" vanish. Swap the surface to `disabledSurface` and the label to `textSecondary` instead.

**Never put `background` on top of `backgroundElement`.** Inside a card, `background` is pure black in dark mode and reads as a hole punched in the surface — chips styled that way looked like unstyled checkboxes. Controls and inputs sitting on a card use `backgroundSelected`.

**All selection controls go through `<SelectChip>`.** Selected is a solid `accent` fill, not a tinted outline: the tinted version was nearly the same value as the dark card behind it. If you need a new selector, use this component rather than restyling a `Pressable`.

**Don't scale a full-width element to animate it.** The check-in pop originally scaled the whole habit row, which pushed it past the screen edges and clipped its corners; it now scales only the badge. Transition animations must also skip the mount pass, or every already-complete habit animates on load.

### Cross-platform gotchas already paid for

**`Alert.alert` cannot render a three-button dialog on web.** React Native Web's implementation maps onto `window.confirm`, which only has OK/Cancel — a two-button case. `HabitMenu` (edit/delete on a habit row) hit this: the alert fired with no visible error, edit and delete simply had nothing to render into on web while working fine on device. Any menu with more than two choices needs a real component (`HabitMenu` uses RN's `Modal`), not `Alert.alert`.

**Nested `Pressable`s don't isolate a tap on web** the way native's responder system does — a tap on an inner control bubbles to an outer one and can dismiss it out from under itself. `HabitMenu`'s card calls `e.stopPropagation()` on its own `Pressable` for exactly this reason. Skip `accessibilityRole="button"` on a tap-to-dismiss scrim, too — it renders a real `<button>` on web, and a `<button>` can't legally contain the buttons inside it.

## Conventions

- **Routes live in `src/app/`, not `app/`** (the stock README says `app/` — it's wrong for this repo).
- Import via the `@/*` alias → `src/*`, and `@/assets/*` → `assets/*`.
- Typed routes are enabled. Route types are generated into `.expo/types` **by running the dev server**. After adding or renaming a route, `npx tsc --noEmit` fails on the old route union until the dev server regenerates them — start it, don't hand-edit.
- `expo-env.d.ts` is generated and gitignored, but typecheck fails without it (it declares the CSS-module and `*.css` types). A fresh clone needs one dev-server run before `tsc` passes.
- Theme colors live in `src/constants/theme.ts`. Every key must exist in **both** `light` and `dark` — the `ThemeColor` type is their intersection, and adding to one only will break `ThemedText`/`ThemedView` consumers.
- React Compiler is enabled (`experiments.reactCompiler`), so keep render paths free of mutation.
