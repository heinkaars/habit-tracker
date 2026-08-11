-- Habit tracker schema.
--
-- Shape notes, because a few columns look odd until you know the domain:
--
--   * `habits.created_at` and the date columns on challenges/check-ins are
--     `date`, not `timestamptz`. The app's unit of time is a *local* day key
--     ("the user's today"), and a timestamptz would drag UTC back into it.
--   * `reminder_time` is text, not `time`. It is a local wall-clock HH:MM with
--     no timezone attached; `time` would round-trip as '07:00:00' and invite
--     someone to start treating it as an instant.
--   * Check-ins are their own table keyed (habit_id, day) rather than a jsonb
--     log on the habit. That makes the merge unit a single day-cell, so two
--     devices editing different days combine instead of one clobbering the
--     other's whole history.
--   * `updated_at` is set by the *client* to the time of the local edit, not by
--     a trigger. Sync is last-write-wins, and it should reflect when the user
--     actually made the change rather than when the device happened to
--     reconnect. Known tradeoff: a device with a badly wrong clock wins or
--     loses unfairly. The default below only guards against a client omitting
--     it entirely.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: one row per user, holding account-level settings.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  onboarded         boolean     not null default false,
  sound             boolean     not null default true,
  haptics           boolean     not null default true,
  reminders_enabled boolean     not null default false,
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- habits
-- ---------------------------------------------------------------------------
create table if not exists public.habits (
  id            uuid primary key,
  user_id       uuid        not null references auth.users (id) on delete cascade,
  name          text        not null check (length(trim(name)) > 0),
  emoji         text        not null,
  kind          text        not null check (kind in ('binary', 'count')),
  -- Binary habits are simply target 1; nothing downstream branches on kind.
  target        integer     not null check (target >= 1),
  created_at    date        not null,
  reminder_time text        check (reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  -- Tombstone. A hard delete would be resurrected by the next pull from a
  -- device that still has the row.
  deleted_at    timestamptz,
  updated_at    timestamptz not null default now(),

  constraint habits_binary_target_is_one check (kind <> 'binary' or target = 1)
);

create index if not exists habits_user_updated_idx
  on public.habits (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- check_ins: one row per (habit, day). Maps to `Habit.log` in the app.
-- ---------------------------------------------------------------------------
create table if not exists public.check_ins (
  habit_id   uuid        not null references public.habits (id) on delete cascade,
  -- Denormalised from habits so RLS is a column comparison rather than a
  -- subquery on every row.
  user_id    uuid        not null references auth.users (id) on delete cascade,
  day        date        not null,
  -- Zero is stored, not deleted. Sync pulls a delta on `updated_at`, and a
  -- deleted row has no `updated_at` to find it by — undoing a check-in would
  -- never reach the other device. A count of 0 maps back to an absent key in
  -- the app's log, so `logStep` wrapping to zero still round-trips exactly.
  count      integer     not null check (count >= 0),
  updated_at timestamptz not null default now(),

  primary key (habit_id, day)
);

create index if not exists check_ins_user_updated_idx
  on public.check_ins (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- challenges
-- ---------------------------------------------------------------------------
create table if not exists public.challenges (
  id           uuid primary key,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  habit_id     uuid        not null references public.habits (id) on delete cascade,
  name         text        not null,
  length_days  integer     not null check (length_days between 1 and 365),
  started_at   date        not null,
  -- The day the final day was fulfilled, or null while in progress.
  completed_at date,
  deleted_at   timestamptz,
  updated_at   timestamptz not null default now()
);

create index if not exists challenges_user_updated_idx
  on public.challenges (user_id, updated_at desc);

-- ---------------------------------------------------------------------------
-- Row level security.
--
-- This is the part that actually answers "who is accessing which data". Every
-- policy is the same column comparison; there is no app code path that can
-- read another user's rows, because the check lives in the database.
-- ---------------------------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.habits     enable row level security;
alter table public.check_ins  enable row level security;
alter table public.challenges enable row level security;

drop policy if exists "profiles are private" on public.profiles;
create policy "profiles are private"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "habits are private" on public.habits;
create policy "habits are private"
  on public.habits for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "check-ins are private" on public.check_ins;
create policy "check-ins are private"
  on public.check_ins for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "challenges are private" on public.challenges;
create policy "challenges are private"
  on public.challenges for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Give every new user a profile row, so the client never has to branch on
-- "signed in but no profile yet".
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.profiles, public.habits, public.check_ins, public.challenges
  to authenticated;
