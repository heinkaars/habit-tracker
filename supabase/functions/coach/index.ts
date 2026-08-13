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
import { clientForRequest, json, preflight } from '../_shared/http.ts';
import { isDayKey } from '../_shared/stats.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const supabase = clientForRequest(req);
  if (!supabase) return json({ error: 'Missing Authorization header.' }, 401);

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return json({ error: 'Not signed in.' }, 401);

  // "Today" comes from the device. This function runs in UTC and must not
  // decide what the user's today is — for anyone east of UTC in the evening,
  // the server's date is already tomorrow.
  const body = await req.json().catch(() => ({}));
  const today = body?.today;
  if (!isDayKey(today)) {
    return json({ error: '`today` must be a YYYY-MM-DD local day key.' }, 400);
  }

  try {
    const { note, cached } = await getOrGenerateCoachNote(supabase, auth.user.id, today);
    return json({ note, cached });
  } catch (cause) {
    const status = cause instanceof RefusalError ? 422 : 502;
    return json({ error: cause instanceof Error ? cause.message : 'Generation failed.' }, status);
  }
});
