/**
 * Pure habit logic — no React, no storage. Everything here is deterministic so
 * the screens stay dumb and the rules are easy to reason about.
 */

import { newId } from '@/lib/ids';

/**
 * `binary` habits are done-or-not once a day. `count` habits need `target`
 * repetitions in a day (drink water 4x). Both share one log shape so streaks,
 * rates and charts never branch on kind.
 */
export type HabitKind = 'binary' | 'count';

export type Habit = {
  id: string;
  name: string;
  emoji: string;
  kind: HabitKind;
  /** Repetitions needed for a day to count as complete. Always 1 for binary. */
  target: number;
  createdAt: string;
  /** Local `HH:MM` to nudge at, or null for no reminder on this habit. */
  reminderTime: string | null;
  /**
   * Tombstone: ISO instant the habit was deleted, or null while it's live.
   *
   * A deleted habit is kept rather than dropped from the array, because sync
   * has to be able to tell "deleted here" from "not yet created here" — a hard
   * delete is resurrected by the next pull from a device that still has it.
   * `useHabits()` hides these, so screens never see one.
   */
  deletedAt: string | null;
  /** Day key -> repetitions logged that day. Absent means zero. */
  log: Record<string, number>;
};

/** `HH:MM` -> {hour, minute}, or null if unparseable. */
export function parseTime(value: string | null): { hour: number; minute: number } | null {
  if (!value) return null;

  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute };
}

export function formatTime(value: string | null): string {
  const parsed = parseTime(value);
  if (!parsed) return 'Off';

  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
}

/** Local-time `YYYY-MM-DD`. Deliberately not UTC — "today" means the user's today. */
export function dayKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Rebuilds the date from parts so DST shifts can't push us onto the wrong day. */
export function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

export function parseDayKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** `count` day keys ending today, oldest first. */
export function recentDays(count: number, today: Date = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => dayKey(addDays(today, i - count + 1)));
}

export function progressOn(habit: Habit, key: string): number {
  return habit.log[key] ?? 0;
}

export function isComplete(habit: Habit, key: string): boolean {
  return progressOn(habit, key) >= habit.target;
}

/**
 * One tap. Binary habits flip; count habits step up and wrap back to zero once
 * the target is passed, so a mis-tap is always three taps from correct rather
 * than stuck.
 */
export function logStep(habit: Habit, key: string): Habit {
  const current = progressOn(habit, key);
  const next = current >= habit.target ? 0 : current + 1;
  const log = { ...habit.log };

  if (next === 0) {
    delete log[key];
  } else {
    log[key] = next;
  }

  return { ...habit, log };
}

/**
 * Consecutive complete days ending today. A day that isn't over yet shouldn't
 * count as a miss, so an incomplete today falls back to counting from yesterday.
 */
export function streak(habit: Habit, today: Date = new Date()): number {
  const start = isComplete(habit, dayKey(today)) ? 0 : -1;
  if (start === -1 && !isComplete(habit, dayKey(addDays(today, -1)))) {
    return 0;
  }

  let count = 0;
  for (let i = start; ; i -= 1) {
    if (!isComplete(habit, dayKey(addDays(today, i)))) return count;
    count += 1;
  }
}

/** Best run of complete days ever recorded, for the insights screen. */
export function longestStreak(habit: Habit): number {
  const days = completeDays(habit);
  if (days.length === 0) return 0;

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    const previous = addDays(parseDayKey(days[i]), -1);
    if (dayKey(previous) === days[i - 1]) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }

  return best;
}

/** Complete day keys, oldest first. */
export function completeDays(habit: Habit): string[] {
  return Object.keys(habit.log)
    .filter((key) => isComplete(habit, key))
    .sort();
}

export function totalCheckIns(habit: Habit): number {
  return Object.values(habit.log).reduce((sum, value) => sum + value, 0);
}

/** Share of the last `days` days that were complete, as 0–1. */
export function completionRate(habit: Habit, days: number, today: Date = new Date()): number {
  const window = recentDays(days, today);
  const hits = window.filter((key) => isComplete(habit, key)).length;

  return hits / days;
}

export function createHabit(
  name: string,
  emoji: string,
  kind: HabitKind,
  target: number,
  reminderTime: string | null = null,
  today: Date = new Date(),
): Habit {
  return {
    id: newId(),
    name: name.trim(),
    emoji,
    kind,
    target: kind === 'binary' ? 1 : Math.max(2, Math.round(target)),
    createdAt: dayKey(today),
    reminderTime: parseTime(reminderTime) ? reminderTime : null,
    deletedAt: null,
    log: {},
  };
}

export const EMOJI_CHOICES = [
  '✅', '🏃', '📖', '💧', '🧘', '🌙', '🥗', '🎸',
  '🚶', '💊', '🥦', '🧠', '💤',
] as const;

/**
 * Starter data so a fresh install has something to look at. The completion
 * patterns are hardcoded rather than random to keep the demo reproducible.
 */
export function seedHabits(today: Date = new Date()): Habit[] {
  const spec = [
    {
      name: 'Morning run',
      emoji: '🏃',
      kind: 'binary' as const,
      target: 1,
      reminderTime: '07:00',
      daysAgo: [0, 1, 2, 4, 5, 6, 8, 9, 11, 12, 13],
    },
    {
      name: 'Read 20 pages',
      emoji: '📖',
      kind: 'binary' as const,
      target: 1,
      reminderTime: '21:00',
      daysAgo: [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12],
    },
    {
      name: 'Drink water',
      emoji: '💧',
      kind: 'count' as const,
      target: 4,
      reminderTime: '12:00',
      daysAgo: [1, 2, 3, 5, 6, 7, 9, 10],
    },
    {
      name: 'No phone after 10pm',
      emoji: '🌙',
      kind: 'binary' as const,
      target: 1,
      reminderTime: null,
      daysAgo: [2, 3, 6, 7, 10, 13],
    },
  ];

  // Ids are generated rather than `seed-0`…`seed-3`: those are identical for
  // every install, so two seeded accounts would collide on the primary key.
  return spec.map((habit) => ({
    id: newId(),
    name: habit.name,
    emoji: habit.emoji,
    kind: habit.kind,
    target: habit.target,
    createdAt: dayKey(addDays(today, -30)),
    reminderTime: habit.reminderTime,
    deletedAt: null,
    log: Object.fromEntries(habit.daysAgo.map((offset) => [dayKey(addDays(today, -offset)), habit.target])),
  }));
}

/** The pre-habit-kinds shape, kept only so stored data can be read forward. */
type HabitV1 = {
  id: string;
  name: string;
  emoji: string;
  createdAt: string;
  done: string[];
};

export function migrateV1(habits: HabitV1[]): Habit[] {
  return habits.map((habit) => ({
    id: habit.id,
    name: habit.name,
    emoji: habit.emoji,
    kind: 'binary',
    target: 1,
    createdAt: habit.createdAt,
    reminderTime: null,
    deletedAt: null,
    log: Object.fromEntries(habit.done.map((key) => [key, 1])),
  }));
}
