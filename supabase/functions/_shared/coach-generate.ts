/**
 * The coaching-note prompt and throttle logic, in one place.
 *
 * Two callers use this: `coach/index.ts`, invoked by a signed-in user opening
 * the app, and `coach-cadence/index.ts`, a scheduled sweep that generates a
 * user's note ahead of time so it's already there when they open the app.
 * Both need the exact same prompt, schema, and cache-then-generate behavior —
 * splitting them would risk the two drifting the way `stats.ts` already warns
 * about for the streak rules, just for prose instead of arithmetic.
 *
 * Callers differ only in *how* they're allowed to reach a user's data: one
 * authenticates as that user and rides RLS, the other runs as a scheduled job
 * with no user to authenticate as and uses a service-role client instead. This
 * function takes whichever `SupabaseClient` the caller has already built and
 * scopes every query to `userId` explicitly regardless — under RLS that's
 * redundant-but-harmless, under service role it's the only thing scoping the
 * query at all.
 */

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { generateJson } from './claude.ts';
import { addDays, buildSnapshot, type CheckInRow, type DayKey, type HabitRow } from './stats.ts';

/** How far back to read check-ins. Long enough that a real streak is never clipped. */
const HISTORY_DAYS = 400;

/**
 * Most habits a single note is built from.
 *
 * Every habit's name and emoji is copied verbatim into the snapshot the model
 * reads, so an unbounded row count is an unbounded (and billed) input. The
 * database caps active habits at 100 per account (`0007_bound_ai_spend.sql`);
 * this is the second line, so a stale or dropped constraint can't turn one
 * cache miss into a multi-megabyte call.
 */
const MAX_HABITS = 100;

/**
 * Distinct days with real activity before a note is worth generating.
 *
 * Two reasons, and the product one came first: a note written about an account
 * with no history says nothing, because there is nothing to say. The security
 * one is that the per-account throttle is keyed `(user_id, day)`, so a fresh
 * account is a fresh quota — and before this, one habit row was the entire
 * admission fee for five billed calls. Requiring history doesn't make scripted
 * abuse impossible (check-in rows are as insertable as habit rows), it makes it
 * cost more than a signup. Captcha on signup is the primary control; this is
 * defence in depth behind it.
 */
const MIN_ACTIVE_DAYS = 3;

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

export type CoachNote = {
  day: DayKey;
  headline: string;
  body: string;
  focusHabitId: string | null;
  suggestion: string | null;
  dismissedAt: string | null;
};

type CoachRow = {
  day: string;
  headline: string;
  body: string;
  focus_habit_id: string | null;
  suggestion: string | null;
  dismissed_at: string | null;
};

const COACH_SELECT = 'day, headline, body, focus_habit_id, suggestion, dismissed_at';

function toNote(row: CoachRow): CoachNote {
  return {
    day: row.day as DayKey,
    headline: row.headline,
    body: row.body,
    focusHabitId: row.focus_habit_id,
    suggestion: row.suggestion,
    dismissedAt: row.dismissed_at,
  };
}

/**
 * Returns today's note for a user: the cached row if `coach_messages` already
 * has one, otherwise computes the snapshot, asks Claude, stores the result,
 * and returns it. Throws on a model refusal or a database error — the two
 * callers handle those differently (one turns it into an HTTP status, the
 * other logs it and moves on to the next user in the sweep), so this stays
 * agnostic to how the failure is reported.
 */
export async function getOrGenerateCoachNote(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  userId: string,
  today: DayKey,
  /**
   * True when `supabase` is a service-role client with no session behind it —
   * i.e. the scheduled sweep. It selects the spend-claim function that accepts
   * a user id; the signed-in path uses the one that derives identity from
   * `auth.uid()` and cannot name another account. See `0007_bound_ai_spend.sql`.
   */
  { elevated = false }: { elevated?: boolean } = {},
): Promise<{ note: CoachNote | null; cached: boolean }> {
  const { data: cached } = await supabase
    .from('coach_messages')
    .select(COACH_SELECT)
    .eq('user_id', userId)
    .eq('day', today)
    .maybeSingle();

  if (cached) return { note: toNote(cached as CoachRow), cached: true };

  const since = addDays(today, -HISTORY_DAYS);

  const [habitsRes, checkInsRes, challengeRes] = await Promise.all([
    supabase
      .from('habits')
      .select('id, name, emoji, kind, target, created_at, reminder_time, deleted_at')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(MAX_HABITS),
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
  if (error) throw new Error(error.message);

  const habits = (habitsRes.data ?? []) as HabitRow[];
  // Nothing to coach about yet — and no reason to spend a model call saying so.
  if (habits.length === 0) return { note: null, cached: false };

  const checkIns = (checkInsRes.data ?? []) as CheckInRow[];

  // A stored zero means "logged nothing that day" (it exists so an undo can
  // propagate between devices), so it is not activity. See `buildLogs`.
  const activeDays = new Set(checkIns.filter((row) => row.count > 0).map((row) => row.day));
  if (activeDays.size < MIN_ACTIVE_DAYS) return { note: null, cached: false };

  // Reserve the spend before making it. A call that fails or times out may
  // still have been billed, so the claim has to happen ahead of the request
  // rather than alongside the row that stores its result.
  const { data: claimed, error: claimError } = elevated
    ? await supabase.rpc('claim_ai_generation_for', { p_user_id: userId, p_kind: 'coach' })
    : await supabase.rpc('claim_ai_generation', { p_kind: 'coach' });

  if (claimError) throw new Error(claimError.message);
  // Cap reached. Same degraded state as no network: no card, no error to
  // dismiss, and the cached path keeps serving whatever already exists.
  if (claimed !== true) return { note: null, cached: false };

  const snapshot = buildSnapshot(
    habits,
    checkIns,
    challengeRes.data ?? null,
    today,
    HISTORY_DAYS,
  );

  const output = await generateJson<CoachOutput>({
    system: SYSTEM,
    input: snapshot,
    schema: SCHEMA,
    effort: 'low',
    maxTokens: 1500,
  });

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

  // A concurrent request may have written today's note first — a person
  // opening the app the same hour the sweep reaches them, say. That's the
  // throttle working, not a failure: fall through and return what landed.
  if (insertError) {
    const { data: winner } = await supabase
      .from('coach_messages')
      .select(COACH_SELECT)
      .eq('user_id', userId)
      .eq('day', today)
      .maybeSingle();

    if (winner) return { note: toNote(winner as CoachRow), cached: true };
    throw new Error(insertError.message);
  }

  return {
    note: {
      day: today,
      headline: output.headline,
      body: output.body,
      focusHabitId,
      suggestion,
      dismissedAt: null,
    },
    cached: false,
  };
}
