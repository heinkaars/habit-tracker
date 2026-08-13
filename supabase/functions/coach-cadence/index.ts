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
 *
 * POST only, and the secret is compared in constant time. If the scheduler was
 * set up with a GET, it will start returning 405 — update the `cron.schedule`
 * call to `net.http_post`.
 */

import { timingSafeEqual } from 'jsr:@std/crypto@1/timing-safe-equal';
import { createClient } from 'jsr:@supabase/supabase-js@2';

import { RefusalError } from '../_shared/claude.ts';
import { getOrGenerateCoachNote } from '../_shared/coach-generate.ts';
import { localNow, type DayKey } from '../_shared/stats.ts';

/** Local hour each user's note is generated for. */
const TARGET_HOUR = 7;

/**
 * No CORS and no preflight, unlike `coach` and `reflect`.
 *
 * Those two are called by the app from a browser on web, so they have to
 * answer an OPTIONS probe. A scheduler is not a browser and never sends one —
 * advertising this endpoint to page scripts would be surface with no caller.
 */
function reply(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Constant-time check of the shared secret.
 *
 * This function runs as the service role with `verify_jwt = false`, so this
 * header is the only thing standing in front of every user's data — the one
 * place in the project where a `!==` short-circuiting on the first wrong byte
 * is worth replacing on principle, even though remote timing attacks across
 * the platform's network jitter aren't practical. Lengths are compared first
 * because `timingSafeEqual` requires equal-sized inputs.
 */
function authorized(req: Request, secret: string): boolean {
  const encoder = new TextEncoder();
  const presented = encoder.encode(req.headers.get('Authorization') ?? '');
  const expected = encoder.encode(`Bearer ${secret}`);

  return presented.byteLength === expected.byteLength && timingSafeEqual(presented, expected);
}

/**
 * The elevated key this function reads with, resolved across both of the key
 * systems a Supabase project can have live at once.
 *
 * `SUPABASE_SECRET_KEYS` is the newer injection: a JSON dictionary of named
 * `sb_secret_...` keys, `default` being the one created with the project.
 * `SUPABASE_SERVICE_ROLE_KEY` is the legacy JWT — deprecated by Supabase at the
 * end of 2026, and revoked wholesale the moment legacy keys are switched off in
 * the dashboard. If it were the only source, that switch would silently take
 * this sweep down, and a dead sweep is invisible from the app because the
 * on-demand path in `coach` covers for it.
 *
 * Preferring the new key makes retiring the legacy one a dashboard action
 * rather than a redeploy; keeping the fallback means this still runs on a
 * project that has no secret keys yet. Both are the same privilege level —
 * service-role, RLS-bypassing — so this widens nothing.
 */
function serviceKey(): { key: string; source: 'secret_keys' | 'legacy_jwt' } {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');

  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, unknown>;
      const key = keys.default ?? Object.values(keys)[0];
      if (typeof key === 'string' && key.length > 0) return { key, source: 'secret_keys' };
    } catch {
      // A shape change in a platform-injected variable shouldn't take the
      // sweep down while a working legacy key is still sitting right there.
    }
  }

  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return { key: legacy, source: 'legacy_jwt' };

  throw new Error('No service key available: SUPABASE_SECRET_KEYS and SUPABASE_SERVICE_ROLE_KEY are both unusable.');
}

Deno.serve(async (req: Request) => {
  // A sweep mutates state and bills model calls; it is not a GET.
  if (req.method !== 'POST') return reply({ error: 'Use POST.' }, 405);

  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || !authorized(req, secret)) {
    return reply({ error: 'Unauthorized.' }, 401);
  }

  // Resolved after the secret check, not at module scope: only the secret
  // holder should be able to tell a misconfigured key apart from a healthy one,
  // and a throw up here would 500 every request instead of failing this one.
  let key: string;
  let keySource: 'secret_keys' | 'legacy_jwt';
  try {
    ({ key, source: keySource } = serviceKey());
  } catch (cause) {
    console.error('[coach-cadence]', cause);
    return reply({ error: (cause as Error).message }, 500);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, key);

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, timezone')
    .not('timezone', 'is', null);

  // Only the secret holder ever sees this body, so the detail is safe here and
  // is what makes a failed sweep diagnosable from the scheduler's run log.
  if (error) {
    console.error('[coach-cadence]', error);
    return reply({ error: error.message }, 500);
  }

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

  // `keySource` is here so the legacy-key migration is verifiable *before* the
  // dashboard switch that would expose getting it wrong: it says which key
  // system actually resolved, and the only reader is whoever holds CRON_SECRET.
  // Once this reads `secret_keys`, turning legacy keys off is safe for this
  // function. It names the source, never the key.
  return reply({ total: profiles?.length ?? 0, generated, skipped, failed, keySource }, 200);
});
