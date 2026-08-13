-- Lets a scheduled job know what "morning" means for each user, so the daily
-- coaching note can be generated proactively rather than only on first open.
--
-- Nullable and additive: until a client pushes a value (next sync after this
-- ships), the scheduled sweep simply skips that user — the on-demand path in
-- `coach` still covers them exactly as it always has. Nothing here changes
-- the throttle; `coach_messages`'s existing `unique (user_id, day)` already
-- does that job whether the row is written by a person opening the app or by
-- the sweep running ahead of them.
alter table public.profiles
  add column if not exists timezone text;
