-- Strip the privileges nobody granted on purpose.
--
-- Every `grant` in 0001/0002 lists `select, insert, update, delete` and nothing
-- else, so reading the migrations suggests that is what the API roles hold. It
-- isn't. Supabase ships `alter default privileges ... grant all` for `anon` and
-- `authenticated` in the `public` schema, so each table also picked up
-- TRUNCATE, REFERENCES and TRIGGER, and `anon` picked up the full write set.
-- Checked on the live database, every table read:
--
--   anon / authenticated -> DELETE, INSERT, REFERENCES, SELECT, TRIGGER,
--                           TRUNCATE, UPDATE
--
-- Two of those matter.
--
--   * **TRUNCATE is not subject to row level security.** Every other write is
--     filtered by `auth.uid() = user_id`, which is why `anon` holding DELETE is
--     harmless — `auth.uid()` is null for it, so no row ever matches. TRUNCATE
--     skips policies entirely and empties the table for every user at once.
--     It is not reachable through PostgREST today, which exposes no such verb,
--     so this is a latent hole rather than a live one — but it is one RPC or
--     one direct role connection away from being the whole dataset, and
--     nothing in this app has ever needed it.
--   * **`anon` writes.** RLS already reduces them to zero rows. Revoking makes
--     that structural instead of a property of the policies, so a future table
--     that ships before its policy isn't briefly world-writable.
--
-- `anon` keeps SELECT deliberately: RLS already returns nothing for it, and
-- removing it would turn an empty result into a permission error on any path
-- that reads before the session settles.

revoke truncate, references, trigger
  on public.profiles, public.habits, public.check_ins, public.challenges,
     public.coach_messages, public.reflections
  from anon, authenticated;

revoke insert, update, delete
  on public.profiles, public.habits, public.check_ins, public.challenges,
     public.coach_messages, public.reflections
  from anon;

-- Stop the next table inheriting the same ambient set. Default privileges are
-- per-granting-role, and migrations run as `postgres`, so this covers anything
-- a future migration creates here.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke insert, update, delete on tables from anon;
