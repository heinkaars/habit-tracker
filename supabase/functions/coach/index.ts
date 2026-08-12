/**
 * Smart coaching nudge — one short, specific note per user per local day.
 *
 * Flow: authenticate as the caller → return the cached note if today's already
 * exists → otherwise compute the statistics, ask Claude to interpret them,
 * store the result, return it. The cache check comes before the model call, so
 * reopening the app costs a single indexed SELECT rather than a generation.
 */

import { generateJson, RefusalError } from '../_shared/claude.ts';
import { clientForRequest, json, preflight } from '../_shared/http.ts';
import { addDays, buildSnapshot, isDayKey, type CheckInRow, type HabitRow } from '../_shared/stats.ts';

/** How far back to read check-ins. Long enough that a real streak is never clipped. */
const HISTORY_DAYS = 400;

const SYSTEM = `You write the short coaching note at the top of a habit tracker's Today screen. The person reads it in a couple of seconds, before logging their habits.

You receive a JSON snapshot in which every statistic is already computed. Treat those numbers as the only facts available: do not recalculate them, estimate around them, or mention a figure that isn't there. \`asOf\` is today's date, and \`doneOnAsOf\` says whether each habit is already logged today.

Ground the note in one specific thing. Name the habit, cite the number you are reacting to, and say what it suggests. A note that would read the same for any user isn't worth showing.

Pick the angle the data supports: a streak worth protecting, one habit slipping while the others hold, or a target that looks too ambitious for the rate actually being achieved. If everything is steady, say so plainly and briefly rather than inventing a concern.

Write to the person as "you". Keep the headline under six words and the body to one or two sentences. The person changes their own targets, so phrase any suggestion as something to consider rather than an instruction.`;

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Under six words.' },
    body: { type: 'string', description: 'One or two sentences addressed to the person.' },
    focusHabitId: {
      type: 'string',
      description: 'The id of the habit this note is about, or an empty string if it is about the whole set.',
    },
    suggestion: {
      type: 'string',
      description: 'One short advisory sentence, or an empty string if there is nothing worth suggesting.',
    },
  },
  required: ['headline', 'body', 'focusHabitId', 'suggestion'],
  additionalProperties: false,
} as const;

type CoachOutput = {
  headline: string;
  body: string;
  focusHabitId: string;
  suggestion: string;
};

type CoachRow = {
  headline: string;
  body: string;
  focus_habit_id: string | null;
  suggestion: string | null;
  dismissed_at: string | null;
  day: string;
};

function toNote(row: CoachRow) {
  return {
    day: row.day,
    headline: row.headline,
    body: row.body,
    focusHabitId: row.focus_habit_id,
    suggestion: row.suggestion,
    dismissedAt: row.dismissed_at,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const supabase = clientForRequest(req);
  if (!supabase) return json({ error: 'Missing Authorization header.' }, 401);

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return json({ error: 'Not signed in.' }, 401);
  const userId = auth.user.id;

  // "Today" comes from the device. This function runs in UTC and must not
  // decide what the user's today is — for anyone east of UTC in the evening,
  // the server's date is already tomorrow.
  const body = await req.json().catch(() => ({}));
  const today = body?.today;
  if (!isDayKey(today)) {
    return json({ error: '`today` must be a YYYY-MM-DD local day key.' }, 400);
  }

  const { data: cached } = await supabase
    .from('coach_messages')
    .select('day, headline, body, focus_habit_id, suggestion, dismissed_at')
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle();

  if (cached) return json({ note: toNote(cached as CoachRow), cached: true });

  const since = addDays(today, -HISTORY_DAYS);

  const [habitsRes, checkInsRes, challengeRes] = await Promise.all([
    supabase
      .from('habits')
      .select('id, name, emoji, kind, target, created_at, reminder_time, deleted_at')
      .eq('user_id', userId)
      .is('deleted_at', null),
    supabase
      .from('check_ins')
      .select('habit_id, day, count')
      .eq('user_id', userId)
      .gte('day', since)
      .limit(20000),
    supabase
      .from('challenges')
      .select('habit_id, name, length_days, started_at, completed_at, deleted_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const error = habitsRes.error ?? checkInsRes.error ?? challengeRes.error;
  if (error) return json({ error: error.message }, 500);

  const habits = (habitsRes.data ?? []) as HabitRow[];
  // Nothing to coach about yet — and no reason to spend a model call saying so.
  if (habits.length === 0) return json({ note: null });

  const snapshot = buildSnapshot(
    habits,
    (checkInsRes.data ?? []) as CheckInRow[],
    challengeRes.data ?? null,
    today,
    HISTORY_DAYS,
  );

  let output: CoachOutput;
  try {
    output = await generateJson<CoachOutput>({
      system: SYSTEM,
      input: snapshot,
      schema: SCHEMA,
      effort: 'low',
      maxTokens: 1500,
    });
  } catch (cause) {
    const status = cause instanceof RefusalError ? 422 : 502;
    return json({ error: cause instanceof Error ? cause.message : 'Generation failed.' }, status);
  }

  // The model is told to return a real id or an empty string, but a note
  // pointing at a habit that doesn't exist would render as a dead link — so
  // the id is checked against the set that was actually sent.
  const known = new Set(habits.map((habit) => habit.id));
  const focusHabitId = known.has(output.focusHabitId) ? output.focusHabitId : null;
  const suggestion = output.suggestion.trim() || null;

  const { error: insertError } = await supabase.from('coach_messages').insert({
    user_id: userId,
    day: today,
    headline: output.headline,
    body: output.body,
    focus_habit_id: focusHabitId,
    suggestion,
  });

  // A concurrent request may have written today's note first; the unique
  // constraint rejects the second write. That's the throttle working, not a
  // failure — fall through and return what landed.
  if (insertError) {
    const { data: winner } = await supabase
      .from('coach_messages')
      .select('day, headline, body, focus_habit_id, suggestion, dismissed_at')
      .eq('user_id', userId)
      .eq('day', today)
      .maybeSingle();

    if (winner) return json({ note: toNote(winner as CoachRow), cached: true });
    return json({ error: insertError.message }, 500);
  }

  return json({
    note: {
      day: today,
      headline: output.headline,
      body: output.body,
      focusHabitId,
      suggestion,
      dismissedAt: null,
    },
    cached: false,
  });
});
