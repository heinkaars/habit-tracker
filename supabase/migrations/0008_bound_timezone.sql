-- Bound `profiles.timezone`, the last unbounded user-authored string.
--
-- 0007 capped every string that reaches a billed model call — `habits.name`,
-- `habits.emoji`, `challenges.name` — on the reasoning that PostgREST, not the
-- app, is the real entry point, and RLS happily lets a user write their own
-- rows to any size they like. `timezone` was added by 0003, four migrations
-- earlier and for a different feature, and was not swept up by that pass.
--
-- It matters more than its size suggests, because of who reads it.
-- `coach-cadence` selects `id, timezone` across *every profile in the project*
-- on each hourly run and holds the result in Edge Function memory:
--
--   supabase.from('profiles').select('id, timezone').not('timezone','is',null)
--
-- So this is not one user's row bloating one user's request. A handful of
-- accounts writing multi-megabyte values is enough to bloat or OOM the sweep,
-- and every user's proactive note fails with it. Worse, it fails invisibly —
-- the on-demand path in `coach` generates a note when someone opens the app,
-- which is exactly the "a dead sweep is invisible from the app" failure this
-- project has already lost weeks to (see 0006 and the typo'd-hostname note).
--
-- The value is also passed to `Intl.DateTimeFormat`, where a malformed string
-- throws and is caught per-profile, so the ceiling here is resource
-- consumption rather than anything executing. Bounding the column is the fix;
-- the try/catch stays useful for a *valid-shaped* name Intl doesn't know.

-- 64 characters is comfortable headroom: the longest IANA zone name in current
-- use is `America/Argentina/ComodRivadavia` at 32. The shape check is the
-- second line rather than the control — the length is what closes the hole —
-- and it is kept deliberately permissive so a runtime returning something
-- unusual-but-sane is not rejected:
--
--   * up to three segments, covering `America/Argentina/Buenos_Aires` and
--     `America/Indiana/Indianapolis`;
--   * hyphens for `America/Port-au-Prince`, plus for `Etc/GMT+8`;
--   * a bare single segment for `UTC`.
--
-- `src/hooks/use-habits.tsx` mirrors both bounds before writing, for the same
-- reason `sign-in.tsx` mirrors `minimum_password_length`: a value rejected here
-- would leave the settings op pending and retrying forever, so the two have to
-- move together.
alter table public.profiles
  add constraint profiles_timezone_shape
  check (
    timezone is null
    or (
      length(timezone) <= 64
      and timezone ~ '^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+){0,2}$'
    )
  );
