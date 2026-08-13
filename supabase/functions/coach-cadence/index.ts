/**
 * Scheduled sweep: generates each user's coaching note once their local
 * morning arrives, so it's already sitting in `coach_messages` before they
 * open the app — instead of the on-demand path generating it reactively on
 * first open, which is all that existed before this.
 *
 * Meant to be invoked hourly by a scheduler (pg_cron via the SQL in this
 * project's setup notes — see CLAUDE.md), never by the app. There's no
 * signed-in caller to authenticate as here — a cron tick isn't any particular
 * user — so this checks a dedicated `CRON_SECRET` instead of a user JWT, and
 * uses a service-role client to read across every account. That's a
 * deliberate, narrow exception to how every other function in this project
 * works: `coach` and `reflect` authenticate as the caller and ride RLS, and
 * this is the one place that can't, because there is no caller. Every query
 * this function makes is still scoped to one `user_id` at a time (see
 * `getOrGenerateCoachNote`) — the elevated client widens *reach* across
 * accounts, not the shape of what any single call touches.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { RefusalError } from '../_shared/claude.ts';
import { getOrGenerateCoachNote } from '../_shared/coach-generate.ts';
import { json, preflight } from '../_shared/http.ts';
import { localNow, type DayKey } from '../_shared/stats.ts';

/** Local hour each user's note is generated for. */
const TARGET_HOUR = 7;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, timezone')
    .not('timezone', 'is', null);

  if (error) return json({ error: error.message }, 500);

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const profile of profiles ?? []) {
    let hour: number;
    let day: DayKey;
    try {
      ({ hour, day } = localNow(profile.timezone as string));
    } catch {
      // A malformed timezone value shouldn't take the whole sweep down with
      // it — skip that one profile and keep going.
      failed += 1;
      continue;
    }

    if (hour !== TARGET_HOUR) {
      skipped += 1;
      continue;
    }

    try {
      // Already-cached is the normal case on a second sweep within the same
      // target hour (a retry, an overlapping run) — getOrGenerateCoachNote's
      // cache check makes that a cheap read, not a second generation.
      const { cached } = await getOrGenerateCoachNote(supabase, profile.id, day);
      if (!cached) generated += 1;
    } catch (cause) {
      // A refusal or a transient failure for one user shouldn't stop the
      // sweep from reaching everyone else.
      if (!(cause instanceof RefusalError)) failed += 1;
    }
  }

  return json({ total: profiles?.length ?? 0, generated, skipped, failed });
});
