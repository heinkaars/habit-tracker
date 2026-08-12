-- AI coaching and reflection summaries.
--
-- Both tables are caches of model output, not source data: the app renders
-- whatever is here, and an Edge Function fills them in. That matters for two
-- reasons.
--
--   * A model call takes seconds. Nothing in the check-in path can wait on one,
--     so the app reads a row that already exists and never generates inline.
--   * Model calls cost money. The unique constraints below are the throttle —
--     one coach note per user per local day, one reflection per user per
--     period. Enforcing it here rather than in app code means a retry storm, a
--     double-tap, or two devices racing cannot produce two billed calls.
--
-- `day` and `period_start` are local day keys (see 0001_init.sql), supplied by
-- the client. The Edge Function runs in UTC and must not decide what "today"
-- is on the user's behalf.

-- ---------------------------------------------------------------------------
-- coach_messages: one short nudge per day.
-- ---------------------------------------------------------------------------
create table if not exists public.coach_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  day          date        not null,
  headline     text        not null,
  body         text        not null,
  -- The habit the note is about, when it is about one. Not a foreign key: the
  -- note should survive the habit being deleted rather than vanishing from
  -- history, and the client already filters to habits it can still see.
  focus_habit_id uuid,
  suggestion   text,
  dismissed_at timestamptz,
  created_at   timestamptz not null default now(),

  constraint coach_messages_one_per_day unique (user_id, day)
);

create index if not exists coach_messages_user_day_idx
  on public.coach_messages (user_id, day desc);

-- ---------------------------------------------------------------------------
-- reflections: weekly or monthly report.
-- ---------------------------------------------------------------------------
create table if not exists public.reflections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users (id) on delete cascade,
  period       text        not null check (period in ('week', 'month')),
  period_start date        not null,
  period_end   date        not null,
  headline     text        not null,
  summary      text        not null,
  -- Short bullet lists. jsonb rather than text[] so the shape matches the
  -- model's structured output exactly and needs no translation on either side.
  wins         jsonb       not null default '[]'::jsonb,
  watch_outs   jsonb       not null default '[]'::jsonb,
  suggestion   text,
  created_at   timestamptz not null default now(),

  constraint reflections_one_per_period unique (user_id, period, period_start),
  constraint reflections_period_ordered check (period_end >= period_start)
);

create index if not exists reflections_user_period_idx
  on public.reflections (user_id, period, period_start desc);

-- ---------------------------------------------------------------------------
-- Row level security — same rule as every other table.
--
-- The Edge Function calls Supabase with the *caller's* JWT, not the service
-- role, so these policies apply to it too. That is deliberate: it means a bug
-- in the function cannot read another user's habits, because the database
-- won't return them.
-- ---------------------------------------------------------------------------
alter table public.coach_messages enable row level security;
alter table public.reflections    enable row level security;

drop policy if exists "coach messages are private" on public.coach_messages;
create policy "coach messages are private"
  on public.coach_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "reflections are private" on public.reflections;
create policy "reflections are private"
  on public.reflections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete
  on public.coach_messages, public.reflections
  to authenticated;
