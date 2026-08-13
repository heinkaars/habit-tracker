-- Bound what a single AI generation can *cost*, and how many can happen at all.
--
-- 0004 made the cache tables read-mostly so their unique constraints are a real
-- throttle, and `isPlausibleToday` (0002-era, in `_shared/stats.ts`) stopped a
-- caller inventing fresh cache keys. Together those cap the *number* of billed
-- model calls per existing account at roughly five a day.
--
-- Two axes were still open, and both are reachable by any signed-in user
-- talking straight to PostgREST — no app involved, and RLS permits all of it
-- because they are writing their own rows:
--
--   * **Size.** `habits.name` and `habits.emoji` were unbounded `text`, there
--     was no cap on habits per user, and the query that feeds the model had no
--     LIMIT. Every habit's name and emoji is copied verbatim into the snapshot
--     sent to Claude. 400 habits x a 20 KB name is ~2M input tokens inside one
--     perfectly legitimate cache miss.
--   * **Accounts.** The throttle is keyed `(user_id, day)`, so every new
--     account is a fresh quota. Signup is free, so the cap was per-account on
--     an unbounded number of accounts.
--
-- This migration closes the size axis outright and puts a ceiling on the
-- account axis. The primary control for the account axis is captcha on signup
-- (dashboard: Auth -> Bot and Abuse Protection, mirrored in config.toml); the
-- ledger below is the backstop that makes an overspend bounded and visible
-- rather than unbounded and silent.

-- ---------------------------------------------------------------------------
-- Size: bound every user-authored string that reaches a model call.
--
-- These are the hard stop, because PostgREST — not the app — is the real entry
-- point. `maxLength` on the TextInput is a courtesy so the UI agrees with the
-- constraint; it is not a control.
--
-- 64 code points for an emoji looks generous for one glyph, and is: a ZWJ
-- family sequence is already 7, and flag/skin-tone/profession compounds run
-- longer. The bound exists to stop a 20 KB "emoji", not to police glyph counts.
-- ---------------------------------------------------------------------------
alter table public.habits
  add constraint habits_name_length  check (length(name)  <= 80),
  add constraint habits_emoji_length check (length(emoji) <= 64);

alter table public.challenges
  add constraint challenges_name_length check (length(name) <= 80);

-- Row count is not expressible as a check constraint. SECURITY DEFINER because
-- it must see every row of `habits` to count them, and the caller's RLS view
-- would only show their own — which is in fact all it counts, but the count has
-- to be trustworthy rather than policy-filtered.
create or replace function public.enforce_habit_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*) from public.habits
    where user_id = new.user_id and deleted_at is null
  ) >= 100 then
    raise exception 'habit limit reached (100 active habits per account)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- INSERT only. An UPDATE that tombstones or renames a habit must never be
-- blocked by this — a user at the cap has to stay able to delete their way out
-- of it, and `deleted_at` is set by UPDATE.
drop trigger if exists habits_limit_per_user on public.habits;
create trigger habits_limit_per_user
  before insert on public.habits
  for each row execute function public.enforce_habit_limit();

-- ---------------------------------------------------------------------------
-- Spend: a ledger of billed generations, and a claim function that caps them.
--
-- One row per model call actually attempted. Written *before* the call, not
-- after: a call that fails or times out may still have been billed, so a
-- reservation is the honest accounting unit.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_generations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('coach', 'reflect')),
  -- Server-side UTC date, deliberately not the caller's local day key. This is
  -- a spend window, not a user-facing day, and it must not be caller-chosen —
  -- that is the exact mistake `isPlausibleToday` exists to prevent.
  day        date        not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

-- The cap query is `count(*) where day = today`, so lead on `day`.
create index if not exists ai_generations_day_idx
  on public.ai_generations (day);

create index if not exists ai_generations_user_day_idx
  on public.ai_generations (user_id, day);

alter table public.ai_generations enable row level security;

-- Readable by the owner so a user (or a support query on their behalf) can see
-- their own usage. There is deliberately no INSERT policy and no INSERT grant
-- to any API role: the only writer is the claim function below, whose insert
-- runs as the function owner. A user who could insert here directly could burn
-- the global budget without ever making a model call — turning a spend limit
-- into a denial-of-service lever.
drop policy if exists "ai generations readable by owner" on public.ai_generations;
create policy "ai generations readable by owner"
  on public.ai_generations for select
  using (auth.uid() = user_id);

grant select on public.ai_generations to authenticated;

revoke insert, update, delete, truncate, references, trigger
  on public.ai_generations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The claim: reserve one billed call, or refuse.
--
-- Returns true when the caller may proceed, false when a cap is hit. Callers
-- treat false as "no note today" — the same degraded state as no network, which
-- `lib/coach.ts` already renders as a card that simply doesn't appear.
--
-- The count-then-insert is not serialised: two concurrent claims can both read
-- LIMIT-1 and both insert. That is fine and deliberate — this is a circuit
-- breaker, not an accounting ledger, and being off by the number of in-flight
-- requests does not change what it protects against.
--
-- Both functions are SECURITY DEFINER with `set search_path = public` pinned,
-- and `kind` is checked against the same closed set as the column constraint so
-- a bad value fails with a clear message rather than at the insert. Note that
-- the insert therefore runs as the *owner*, not as the calling role — which is
-- why `ai_generations` needs no INSERT grant to anyone at all.
-- ---------------------------------------------------------------------------

-- Tune to your actual user base.
--
-- The global cap is roughly "20 fully active accounts a day" before it engages;
-- raise it before you have that many real users. The per-user cap is set well
-- above what legitimate use reaches (about nine: five coach day-keys plus the
-- reflection periods) on purpose — a claim is spent even when the model call
-- then fails, so during an upstream outage a user who reopens the app several
-- times would otherwise burn the day's allowance on calls that produced
-- nothing. 25 keeps the bound meaningful while making that lockout implausible.
create or replace function public.ai_daily_global_limit()
returns integer
language sql
immutable
as $$ select 500 $$;

create or replace function public.ai_daily_user_limit()
returns integer
language sql
immutable
as $$ select 25 $$;

-- ---------------------------------------------------------------------------
-- The claim, in two functions rather than one.
--
-- The obvious single function takes a user id and checks it against
-- `auth.uid()` — but that check has to be skipped when `auth.uid()` is null,
-- because `coach-cadence` genuinely has no session to derive an id from. That
-- leaves a shape where "no identity" means "the parameter is trusted", which is
-- the same mistake as reading a user id out of a request body: correct only for
-- as long as nothing that isn't the service role can reach it with a null uid.
--
-- Splitting it means the role boundary is the grant, not a branch:
--
--   * `claim_ai_generation(kind)` takes no id at all. `authenticated` gets this
--     one, and it is structurally incapable of claiming for anyone else.
--   * `claim_ai_generation_for(user_id, kind)` takes one, and only
--     `service_role` may call it.
--
-- The first calls the second. That works despite `authenticated` having no
-- EXECUTE on it, because inside a SECURITY DEFINER function the privilege
-- checks run as the owner.
-- ---------------------------------------------------------------------------
create or replace function public.claim_ai_generation_for(p_user_id uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  used  integer;
begin
  if p_user_id is null then
    raise exception 'p_user_id is required';
  end if;

  -- Same closed set as the column constraint, so a bad value fails here with a
  -- clear message rather than at the insert.
  if p_kind not in ('coach', 'reflect') then
    raise exception 'unknown generation kind: %', p_kind;
  end if;

  select count(*) into used
  from public.ai_generations
  where user_id = p_user_id and day = today;

  if used >= public.ai_daily_user_limit() then
    return false;
  end if;

  select count(*) into used
  from public.ai_generations
  where day = today;

  if used >= public.ai_daily_global_limit() then
    return false;
  end if;

  insert into public.ai_generations (user_id, kind, day)
  values (p_user_id, p_kind, today);

  return true;
end;
$$;

create or replace function public.claim_ai_generation(p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  -- No session, no claim. The service role's path is the other function.
  if caller is null then
    raise exception 'claim_ai_generation requires a signed-in caller';
  end if;

  return public.claim_ai_generation_for(caller, p_kind);
end;
$$;

revoke all on function public.claim_ai_generation_for(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_ai_generation_for(uuid, text) to service_role;

revoke all on function public.claim_ai_generation(text) from public, anon;
grant execute on function public.claim_ai_generation(text) to authenticated;

-- The limit functions are read by nothing but the claim functions, which run as
-- definer. No API role needs to call them.
revoke all on function public.ai_daily_global_limit() from public, anon, authenticated;
revoke all on function public.ai_daily_user_limit()   from public, anon, authenticated;
