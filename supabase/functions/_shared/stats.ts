/**
 * Habit statistics for the Edge Functions.
 *
 * ⚠️ This is a second implementation of the streak and rate rules that live in
 * `src/lib/habits.ts`. It exists because Edge Functions run on Deno and the app
 * module reaches `expo-crypto`, which has no Deno build. The rules are load
 * bearing — CLAUDE.md notes that changing what a streak means changes it
 * everywhere — so the two copies are pinned together by a parity test that runs
 * both over identical fixtures and fails if they disagree. If you change a rule
 * here or there, that test is what catches you.
 *
 * Everything numeric the model sees is computed here. Claude is asked to
 * interpret figures, never to derive them: a language model counting 40 rows of
 * check-ins is slower, costlier, and occasionally wrong, and the arithmetic is
 * six lines.
 */

/** Local day key, `YYYY-MM-DD`. Supplied by the client — see below. */
export type DayKey = string;

export type HabitRow = {
  id: string;
  name: string;
  emoji: string;
  kind: 'binary' | 'count';
  target: number;
  created_at: DayKey;
  reminder_time: string | null;
  deleted_at: string | null;
};

export type CheckInRow = {
  habit_id: string;
  day: DayKey;
  count: number;
};

export type ChallengeRow = {
  habit_id: string;
  name: string;
  length_days: number;
  started_at: DayKey;
  completed_at: DayKey | null;
  deleted_at: string | null;
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: unknown): value is DayKey {
  return typeof value === 'string' && DAY_KEY.test(value);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Day arithmetic on the key itself, in UTC.
 *
 * The key is already the user's local day — a label, not an instant — so the
 * only requirement is that stepping it is exact. UTC has no daylight saving, so
 * `+1 day` is always +1 day here; doing the same maths in the host's local zone
 * would silently skip or repeat a day twice a year depending on where the
 * function happens to run.
 */
export function addDays(key: DayKey, delta: number): DayKey {
  const [year, month, day] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));

  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** `count` day keys ending at `today`, oldest first. */
export function recentDays(count: number, today: DayKey): DayKey[] {
  return Array.from({ length: count }, (_, i) => addDays(today, i - count + 1));
}

/**
 * The current local hour and day key in an IANA timezone (e.g.
 * `"America/New_York"`), via the runtime's own tz database. This is what lets
 * a scheduled sweep — which otherwise only knows UTC — ask "is it currently
 * this user's morning?" without a hand-maintained offset table that would
 * need updating every time a region's DST rules change.
 *
 * Throws if `timeZone` isn't a name `Intl` recognizes — callers with
 * user-supplied values should catch that rather than let one bad row abort
 * the whole run.
 */
export function localNow(timeZone: string): { hour: number; day: DayKey } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = `${get('year')}-${get('month')}-${get('day')}` as DayKey;
  // hour12:false can format midnight as "24" in some runtimes; normalize so a
  // plain `=== targetHour` comparison is reliable at every hour of the day.
  const hour = Number(get('hour')) % 24;

  return { day, hour };
}

export type Period = 'week' | 'month';

/**
 * The most recently *completed* week or month.
 *
 * Reflections look backwards at a finished period rather than the current one:
 * a "weekly summary" generated on a Tuesday would otherwise cover two days, and
 * the period start doubles as the throttle key — a moving window would let one
 * report be generated every day instead of every week.
 */
export function previousPeriod(today: DayKey, period: Period): { start: DayKey; end: DayKey } {
  const [year, month, day] = today.split('-').map(Number);

  if (period === 'week') {
    // Monday-based: getUTCDay() is 0 for Sunday, so rotate it.
    const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
    const thisMonday = addDays(today, -weekday);

    return { start: addDays(thisMonday, -7), end: addDays(thisMonday, -1) };
  }

  const firstOfThisMonth = `${year}-${pad(month)}-01`;
  const end = addDays(firstOfThisMonth, -1);
  const [endYear, endMonth] = end.split('-').map(Number);

  return { start: `${endYear}-${pad(endMonth)}-01`, end };
}

export type Log = Record<DayKey, number>;

/** Groups check-in rows into a per-habit `dayKey -> count` map. */
export function buildLogs(checkIns: CheckInRow[]): Record<string, Log> {
  const logs: Record<string, Log> = {};

  for (const row of checkIns) {
    // A stored zero means "logged nothing that day" — it exists so an undo can
    // propagate between devices. It must not read as progress here.
    if (row.count <= 0) continue;
    (logs[row.habit_id] ??= {})[row.day] = row.count;
  }

  return logs;
}

export function isComplete(target: number, log: Log, key: DayKey): boolean {
  return (log[key] ?? 0) >= target;
}

/**
 * Consecutive complete days ending today. An incomplete *today* does not break
 * the streak — the day isn't over — so it falls back to counting from
 * yesterday. Mirrors `streak()` in `src/lib/habits.ts`.
 */
export function streak(target: number, log: Log, today: DayKey): number {
  const start = isComplete(target, log, today) ? 0 : -1;
  if (start === -1 && !isComplete(target, log, addDays(today, -1))) {
    return 0;
  }

  let count = 0;
  for (let i = start; ; i -= 1) {
    if (!isComplete(target, log, addDays(today, i))) return count;
    count += 1;
  }
}

/** Complete day keys, oldest first. */
export function completeDays(target: number, log: Log): DayKey[] {
  return Object.keys(log)
    .filter((key) => isComplete(target, log, key))
    .sort();
}

export function longestStreak(target: number, log: Log): number {
  const days = completeDays(target, log);
  if (days.length === 0) return 0;

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    if (addDays(days[i], -1) === days[i - 1]) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }

  return best;
}

export function totalCheckIns(log: Log): number {
  return Object.values(log).reduce((sum, value) => sum + value, 0);
}

/** Share of the last `days` days that were complete, as a whole percentage. */
export function completionRate(target: number, log: Log, days: number, today: DayKey): number {
  const hits = recentDays(days, today).filter((key) => isComplete(target, log, key)).length;

  return Math.round((hits / days) * 100);
}

// ---------------------------------------------------------------------------
// Snapshot — the only thing the model ever sees
// ---------------------------------------------------------------------------

export type HabitStat = {
  id: string;
  name: string;
  emoji: string;
  timesPerDay: number;
  currentStreak: number;
  longestStreak: number;
  last7DaysPercent: number;
  last30DaysPercent: number;
  totalCheckIns: number;
  daysTracked: number;
  reminderTime: string | null;
  doneOnAsOf: boolean;
};

export type Snapshot = {
  /**
   * The date every figure is computed as at. Today for a coaching note; the
   * last day of the reported period for a reflection — which is why nothing
   * here is named "today": a reflection's `asOf` is in the past, and a field
   * called `doneToday` invites the model to write "today" about last Sunday.
   */
  asOf: DayKey;
  windowDays: number;
  habits: HabitStat[];
  overall: {
    habitCount: number;
    doneOnAsOf: number;
    bestCurrentStreak: number;
    totalCheckIns: number;
  };
  challenge: {
    name: string;
    habitName: string;
    lengthDays: number;
    daysDone: number;
    daysRemaining: number;
  } | null;
};

function daysBetween(from: DayKey, to: DayKey): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const ms = Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd);

  return Math.round(ms / 86_400_000);
}

/**
 * Assembles the figures the model reasons over. Deleted habits are excluded —
 * the user can't see them, so a note about one would be unexplainable.
 */
export function buildSnapshot(
  habits: HabitRow[],
  checkIns: CheckInRow[],
  challenge: ChallengeRow | null,
  asOf: DayKey,
  windowDays: number,
): Snapshot {
  const live = habits.filter((habit) => !habit.deleted_at);
  const logs = buildLogs(checkIns);

  const stats: HabitStat[] = live.map((habit) => {
    const log = logs[habit.id] ?? {};

    return {
      id: habit.id,
      name: habit.name,
      emoji: habit.emoji,
      timesPerDay: habit.target,
      currentStreak: streak(habit.target, log, asOf),
      longestStreak: longestStreak(habit.target, log),
      last7DaysPercent: completionRate(habit.target, log, 7, asOf),
      last30DaysPercent: completionRate(habit.target, log, 30, asOf),
      totalCheckIns: totalCheckIns(log),
      daysTracked: Math.max(1, daysBetween(habit.created_at, asOf) + 1),
      reminderTime: habit.reminder_time,
      doneOnAsOf: isComplete(habit.target, log, asOf),
    };
  });

  let challengeSummary: Snapshot['challenge'] = null;
  if (challenge && !challenge.deleted_at) {
    const habit = live.find((item) => item.id === challenge.habit_id);
    if (habit) {
      const log = logs[habit.id] ?? {};
      const days = Array.from({ length: challenge.length_days }, (_, i) =>
        addDays(challenge.started_at, i),
      );

      challengeSummary = {
        name: challenge.name,
        habitName: habit.name,
        lengthDays: challenge.length_days,
        daysDone: days.filter((key) => isComplete(habit.target, log, key)).length,
        daysRemaining: Math.max(0, days.filter((key) => key >= asOf).length),
      };
    }
  }

  return {
    asOf,
    windowDays,
    habits: stats,
    overall: {
      habitCount: stats.length,
      doneOnAsOf: stats.filter((stat) => stat.doneOnAsOf).length,
      bestCurrentStreak: stats.reduce((best, stat) => Math.max(best, stat.currentStreak), 0),
      totalCheckIns: stats.reduce((sum, stat) => sum + stat.totalCheckIns, 0),
    },
    challenge: challengeSummary,
  };
}
