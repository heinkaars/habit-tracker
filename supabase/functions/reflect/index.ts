/**
 * Reflection summary — one report per user per completed week or month.
 *
 * Same shape as `coach`: cache first, generate only on a miss. The period is
 * the most recently *finished* week or month, so the report covers a full span
 * and the period start is a stable throttle key.
 */

import { generateJson, RefusalError } from '../_shared/claude.ts';
import { clientForRequest, json, preflight, safeError } from '../_shared/http.ts';
import {
  addDays,
  buildSnapshot,
  isPlausibleToday,
  previousPeriod,
  type CheckInRow,
  type HabitRow,
  type Period,
} from '../_shared/stats.ts';

const SYSTEM = `You write the periodic reflection in a habit tracker. The person opens it to understand how a finished week or month actually went, not to be congratulated.

You receive a JSON snapshot covering that period, with every statistic already computed. Treat those numbers as the only facts available: do not recalculate them, estimate around them, or mention a figure that isn't there. \`asOf\` is the final day of the period, which is already in the past — write about the period in the past tense and never call any of it "today".

Be concrete and comparative. Naming which habit held up and which slipped, with the percentages, is the point of the report — "you were consistent" tells the person nothing they didn't already know. Where the data suggests a cause (a habit with no reminder set, a target well above the rate being achieved), say so.

Report what happened, including when it went badly. A week that went poorly should read as a week that went poorly; softening it makes the good weeks meaningless.

Write to the person as "you". Keep the summary to two or three sentences, wins and watch-outs to at most three short items each, and phrase any suggestion as something to consider rather than an instruction.`;

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'Under eight words, characterising the period.' },
    summary: { type: 'string', description: 'Two or three sentences addressed to the person.' },
    wins: {
      type: 'array',
      description: 'At most three short items. May be empty if the period had none.',
      items: { type: 'string' },
    },
    watchOuts: {
      type: 'array',
      description: 'At most three short items. May be empty.',
      items: { type: 'string' },
    },
    suggestion: {
      type: 'string',
      description: 'One short advisory sentence, or an empty string if there is nothing worth suggesting.',
    },
  },
  required: ['headline', 'summary', 'wins', 'watchOuts', 'suggestion'],
  additionalProperties: false,
} as const;

type ReflectionOutput = {
  headline: string;
  summary: string;
  wins: string[];
  watchOuts: string[];
  suggestion: string;
};

type ReflectionRow = {
  period: Period;
  period_start: string;
  period_end: string;
  headline: string;
  summary: string;
  wins: string[];
  watch_outs: string[];
  suggestion: string | null;
};

function toReflection(row: ReflectionRow) {
  return {
    period: row.period,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    headline: row.headline,
    summary: row.summary,
    wins: row.wins ?? [],
    watchOuts: row.watch_outs ?? [],
    suggestion: row.suggestion,
  };
}

const SELECT = 'period, period_start, period_end, headline, summary, wins, watch_outs, suggestion';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const supabase = clientForRequest(req);
  if (!supabase) return json({ error: 'Missing Authorization header.' }, 401);

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return json({ error: 'Not signed in.' }, 401);
  const userId = auth.user.id;

  const body = await req.json().catch(() => ({}));
  const today = body?.today;
  const period: Period = body?.period === 'month' ? 'month' : 'week';

  // Bounded, not just well-formed: `previousPeriod` derives `period_start`
  // from this, and that is the throttle key for `reflections`. An arbitrary
  // `today` names an arbitrary past week, and each one is a fresh cache miss
  // that bills a model call. See `isPlausibleToday`.
  if (!isPlausibleToday(today)) {
    return json(
      { error: '`today` must be a YYYY-MM-DD local day key within two days of the current date.' },
      400,
    );
  }

  const { start, end } = previousPeriod(today, period);

  const { data: cached } = await supabase
    .from('reflections')
    .select(SELECT)
    .eq('user_id', userId)
    .eq('period', period)
    .eq('period_start', start)
    .maybeSingle();

  if (cached) return json({ reflection: toReflection(cached as ReflectionRow), cached: true });

  // The snapshot reports trailing 7- and 30-day rates as at the end of the
  // period, so the fetch has to cover 30 days even when the period is a week.
  // Fetching only the period itself would leave the other 23 days with no rows,
  // and absent rows read as missed days — handing the model a 30-day figure
  // that is wrong and unfalsifiable.
  const statsFrom = start < addDays(end, -29) ? start : addDays(end, -29);

  const [habitsRes, checkInsRes] = await Promise.all([
    supabase
      .from('habits')
      .select('id, name, emoji, kind, target, created_at, reminder_time, deleted_at')
      .eq('user_id', userId)
      .is('deleted_at', null),
    supabase
      .from('check_ins')
      .select('habit_id, day, count')
      .eq('user_id', userId)
      .gte('day', statsFrom)
      .lte('day', end)
      .limit(20000),
  ]);

  const error = habitsRes.error ?? checkInsRes.error;
  if (error) return safeError(error, 500, 'reflect');

  const habits = (habitsRes.data ?? []) as HabitRow[];
  if (habits.length === 0) return json({ reflection: null });

  const checkIns = (checkInsRes.data ?? []) as CheckInRow[];
  // A period with no activity at all produces a report that says nothing worth
  // a model call — and reads as scolding when the person simply wasn't using
  // the app that week. Judged on the period itself, not the wider stats window.
  const inPeriod = checkIns.filter((row) => row.day >= start && row.day <= end);
  if (inPeriod.every((row) => row.count <= 0)) return json({ reflection: null });

  const days = period === 'week' ? 7 : 30;
  // Stats are computed as at the last day of the period, not today, so the
  // rates describe the period rather than the days since it ended.
  const snapshot = buildSnapshot(habits, checkIns, null, end, days);

  let output: ReflectionOutput;
  try {
    output = await generateJson<ReflectionOutput>({
      system: SYSTEM,
      input: { ...snapshot, period, periodStart: start, periodEnd: end },
      schema: SCHEMA,
      effort: 'medium',
      maxTokens: 3000,
    });
  } catch (cause) {
    return safeError(cause, cause instanceof RefusalError ? 422 : 502, 'reflect');
  }

  const row = {
    user_id: userId,
    period,
    period_start: start,
    period_end: end,
    headline: output.headline,
    summary: output.summary,
    wins: output.wins.slice(0, 3),
    watch_outs: output.watchOuts.slice(0, 3),
    suggestion: output.suggestion.trim() || null,
  };

  const { error: insertError } = await supabase.from('reflections').insert(row);

  if (insertError) {
    const { data: winner } = await supabase
      .from('reflections')
      .select(SELECT)
      .eq('user_id', userId)
      .eq('period', period)
      .eq('period_start', start)
      .maybeSingle();

    if (winner) return json({ reflection: toReflection(winner as ReflectionRow), cached: true });
    return safeError(insertError, 500, 'reflect');
  }

  return json({
    reflection: toReflection({ ...row, watch_outs: row.watch_outs } as ReflectionRow),
    cached: false,
  });
});
