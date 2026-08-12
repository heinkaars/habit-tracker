/**
 * Parity guard for the duplicated habit rules. Run with `npm run test:parity`.
 *
 * `src/lib/habits.ts` (the app) and `supabase/functions/_shared/stats.ts` (the
 * Edge Functions) implement the same streak, rate, and day-key rules against
 * different data shapes — two copies exist because Edge Functions run on Deno
 * and the app module reaches `expo-crypto`, which has no Deno build.
 *
 * This runs both over identical randomised histories and fails if they ever
 * disagree. It is the only thing standing between the two copies and a silent
 * drift in what a streak means, so run it after touching either file.
 */

import {
  addDays as appAddDays,
  completionRate as appRate,
  dayKey,
  isComplete as appIsComplete,
  longestStreak as appLongest,
  streak as appStreak,
  type Habit,
} from '@/lib/habits';

import {
  addDays as edgeAddDays,
  completionRate as edgeRate,
  isComplete as edgeIsComplete,
  longestStreak as edgeLongest,
  previousPeriod,
  streak as edgeStreak,
  type Log,
} from '../../supabase/functions/_shared/stats.ts';

let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}\n         edge=${JSON.stringify(got)} app=${JSON.stringify(want)}`);
  }
}

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function makeHabit(target: number, log: Log): Habit {
  return {
    id: 'h',
    name: 'h',
    emoji: '🏃',
    kind: target === 1 ? 'binary' : 'count',
    target,
    createdAt: '2025-01-01',
    reminderTime: null,
    deletedAt: null,
    log,
  };
}

console.log('\nday-key arithmetic');
{
  // Leap day and both DST boundaries — where a local-time implementation and a
  // UTC one are most likely to diverge.
  const anchors = ['2024-02-28', '2024-02-29', '2025-03-09', '2025-11-02', '2025-12-31'];
  let mismatches = 0;

  for (const anchor of anchors) {
    for (let delta = -400; delta <= 400; delta += 7) {
      const [y, m, d] = anchor.split('-').map(Number);
      const app = dayKey(appAddDays(new Date(y, m - 1, d), delta));
      if (app !== edgeAddDays(anchor, delta)) mismatches += 1;
    }
  }

  check('addDays agrees across leap days and DST boundaries', mismatches, 0);
}

console.log('\nstreaks, rates, and longest run over randomised histories');
{
  const today = '2026-08-11';
  const [ty, tm, td] = today.split('-').map(Number);
  const todayDate = new Date(ty, tm - 1, td);

  let streakMismatch = 0;
  let longestMismatch = 0;
  let rate7Mismatch = 0;
  let rate30Mismatch = 0;
  let completeMismatch = 0;

  for (let seed = 1; seed <= 300; seed += 1) {
    const random = rng(seed);
    const target = 1 + Math.floor(random() * 4);
    const log: Log = {};

    // Density spans "almost never" to "almost always", so both the zero-streak
    // and the long-unbroken-run paths get exercised.
    const density = random();
    for (let back = 0; back < 200; back += 1) {
      if (random() < density) {
        log[edgeAddDays(today, -back)] = 1 + Math.floor(random() * 4);
      }
    }

    const habit = makeHabit(target, log);

    if (appStreak(habit, todayDate) !== edgeStreak(target, log, today)) streakMismatch += 1;
    if (appLongest(habit) !== edgeLongest(target, log)) longestMismatch += 1;

    // The app returns a 0–1 fraction; the edge module returns whole percent.
    if (Math.round(appRate(habit, 7, todayDate) * 100) !== edgeRate(target, log, 7, today)) {
      rate7Mismatch += 1;
    }
    if (Math.round(appRate(habit, 30, todayDate) * 100) !== edgeRate(target, log, 30, today)) {
      rate30Mismatch += 1;
    }

    for (let back = 0; back < 40; back += 1) {
      const key = edgeAddDays(today, -back);
      if (appIsComplete(habit, key) !== edgeIsComplete(target, log, key)) completeMismatch += 1;
    }
  }

  check('streak agrees on 300 histories', streakMismatch, 0);
  check('longestStreak agrees on 300 histories', longestMismatch, 0);
  check('7-day rate agrees on 300 histories', rate7Mismatch, 0);
  check('30-day rate agrees on 300 histories', rate30Mismatch, 0);
  check('isComplete agrees across 12000 day-cells', completeMismatch, 0);
}

console.log('\nthe incomplete-today rule specifically');
{
  const today = '2026-08-11';
  const [ty, tm, td] = today.split('-').map(Number);
  const todayDate = new Date(ty, tm - 1, td);

  // Yesterday and the day before done, today not yet: both must report 2, not 0.
  const log: Log = { '2026-08-10': 1, '2026-08-09': 1 };
  check('incomplete today falls back to yesterday (edge)', edgeStreak(1, log, today), 2);
  check('incomplete today falls back to yesterday (app)', appStreak(makeHabit(1, log), todayDate), 2);

  const broken: Log = { '2026-08-09': 1 };
  check('a gap at yesterday ends the streak (edge)', edgeStreak(1, broken, today), 0);
  check('a gap at yesterday ends the streak (app)', appStreak(makeHabit(1, broken), todayDate), 0);
}

console.log('\nreflection period boundaries');
{
  // 2026-08-11 is a Tuesday; the last complete week is Mon 3rd – Sun 9th.
  check('week is the previous Mon–Sun', previousPeriod('2026-08-11', 'week'), {
    start: '2026-08-03',
    end: '2026-08-09',
  });
  check('week on a Monday looks back a full week', previousPeriod('2026-08-10', 'week'), {
    start: '2026-08-03',
    end: '2026-08-09',
  });
  check('month is the previous calendar month', previousPeriod('2026-08-11', 'month'), {
    start: '2026-07-01',
    end: '2026-07-31',
  });
  check('month rolls back across a year boundary', previousPeriod('2026-01-05', 'month'), {
    start: '2025-12-01',
    end: '2025-12-31',
  });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
