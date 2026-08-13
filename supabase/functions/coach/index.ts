/**
 * On-demand coaching nudge, for a signed-in user opening the app.
 *
 * The prompt and cache-then-generate logic live in `_shared/coach-generate.ts`
 * — this file is just the HTTP boundary: authenticate the caller, validate
 * `today`, hand off, translate the result (or a refusal) into a response. The
 * scheduled sweep in `coach-cadence` calls the exact same shared function, so
 * a note generated ahead of time and one generated on open are identical.
 */

import { RefusalError } from '../_shared/claude.ts';
import { getOrGenerateCoachNote } from '../_shared/coach-generate.ts';
import { clientForRequest, respond } from '../_shared/http.ts';
import { isPlausibleToday } from '../_shared/stats.ts';

Deno.serve(async (req: Request) => {
  const { json, preflight, error: fail } = respond(req);

  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const supabase = clientForRequest(req);
  if (!supabase) return json({ error: 'Missing Authorization header.' }, 401);

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return json({ error: 'Not signed in.' }, 401);

  // "Today" comes from the device. This function runs in UTC and must not
  // decide what the user's today is — for anyone east of UTC in the evening,
  // the server's date is already tomorrow. It is bounded rather than merely
  // well-formed because `coach_messages`' one-per-day constraint is keyed on
  // it: an arbitrary day key is an arbitrary cache key, and every miss bills a
  // model call. See `isPlausibleToday`.
  const body = await req.json().catch(() => ({}));
  const today = body?.today;
  if (!isPlausibleToday(today)) {
    return json(
      { error: '`today` must be a YYYY-MM-DD local day key within two days of the current date.' },
      400,
    );
  }

  try {
    const { note, cached } = await getOrGenerateCoachNote(supabase, auth.user.id, today);
    return json({ note, cached });
  } catch (cause) {
    return fail(cause, cause instanceof RefusalError ? 422 : 502, 'coach');
  }
});
