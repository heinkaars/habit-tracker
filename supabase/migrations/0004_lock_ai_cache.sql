-- Make the AI cache tables read-mostly, so their unique constraints are an
-- actual spend limit.
--
-- `coach_messages` and `reflections` are caches of *billed* model output. The
-- comment in 0002 is right that the unique constraints stop a double-tap or two
-- devices racing from producing two calls — but that only holds against
-- accidents. Both tables were granted `delete` and covered by a `for all`
-- policy, so a user could delete their own cached row and immediately ask for
-- another generation, in a loop, at a perfectly legitimate `today`. The
-- throttle was a cache the caller could clear.
--
-- INSERT deliberately stays. `coach` and `reflect` authenticate as the calling
-- user and ride RLS (see `_shared/http.ts`), so the insert that stores a fresh
-- note is made *as that user* and needs the privilege. A user inserting a row
-- of their own can only suppress their own note, which costs nothing.
--
-- Paired with the `isPlausibleToday` bound in `_shared/stats.ts`: that one stops
-- the caller inventing new cache keys, this one stops them clearing existing
-- ones. Either alone leaves the other route open.

-- ---------------------------------------------------------------------------
-- Privileges. RLS filters rows; it cannot restrict which columns an UPDATE
-- touches, and it does not grant. Revoking the table privilege is the hard
-- stop — the policies below are defence in depth.
-- ---------------------------------------------------------------------------
revoke delete on public.coach_messages, public.reflections from authenticated;
revoke update on public.coach_messages, public.reflections from authenticated;

-- Dismissal is the one legitimate user write. Column-level grant so it cannot
-- widen into rewriting `day`, `headline`, or `body`.
grant update (dismissed_at) on public.coach_messages to authenticated;

-- ---------------------------------------------------------------------------
-- Policies. Split per command so a future migration re-granting the table
-- privilege doesn't silently restore DELETE through a blanket `for all`.
-- ---------------------------------------------------------------------------
drop policy if exists "coach messages are private" on public.coach_messages;

create policy "coach messages readable by owner"
  on public.coach_messages for select
  using (auth.uid() = user_id);

create policy "coach messages insertable by owner"
  on public.coach_messages for insert
  with check (auth.uid() = user_id);

-- Reaches only `dismissed_at`; the grant above is what limits the columns.
create policy "coach messages dismissable by owner"
  on public.coach_messages for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "reflections are private" on public.reflections;

create policy "reflections readable by owner"
  on public.reflections for select
  using (auth.uid() = user_id);

create policy "reflections insertable by owner"
  on public.reflections for insert
  with check (auth.uid() = user_id);
