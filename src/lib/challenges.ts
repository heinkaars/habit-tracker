/**
 * A challenge is a fixed-length commitment to one habit, starting the day it's
 * accepted. It is the app's first reward beat: onboarding hands the user a
 * 3-day challenge so there's a finish line in sight before motivation fades.
 */

import { addDays, dayKey, isComplete, parseDayKey, type Habit } from '@/lib/habits';

export type Challenge = {
  id: string;
  habitId: string;
  lengthDays: number;
  /** Day key of day one. */
  startedAt: string;
  /** Day key the final day was completed, or null while in progress. */
  completedAt: string | null;
};

export const DEFAULT_CHALLENGE_DAYS = 3;

export function createChallenge(
  habitId: string,
  lengthDays: number = DEFAULT_CHALLENGE_DAYS,
  today: Date = new Date(),
): Challenge {
  return {
    id: `challenge-${Date.now()}`,
    habitId,
    lengthDays,
    startedAt: dayKey(today),
    completedAt: null,
  };
}

/** Day keys the challenge covers, oldest first. */
export function challengeDays(challenge: Challenge): string[] {
  const start = parseDayKey(challenge.startedAt);
  return Array.from({ length: challenge.lengthDays }, (_, i) => dayKey(addDays(start, i)));
}

export function challengeProgress(challenge: Challenge, habit: Habit): number {
  return challengeDays(challenge).filter((key) => isComplete(habit, key)).length;
}

export function isFulfilled(challenge: Challenge, habit: Habit): boolean {
  return challengeProgress(challenge, habit) >= challenge.lengthDays;
}

/**
 * Past the last day without every day complete. Expired challenges are shown as
 * missed rather than silently dropped — the user should see what happened.
 */
export function isExpired(challenge: Challenge, habit: Habit, today: Date = new Date()): boolean {
  if (isFulfilled(challenge, habit)) return false;

  const days = challengeDays(challenge);
  return dayKey(today) > days[days.length - 1];
}

/** Days remaining including today, floored at zero. */
export function daysRemaining(challenge: Challenge, today: Date = new Date()): number {
  const days = challengeDays(challenge);
  const remaining = days.filter((key) => key >= dayKey(today)).length;

  return Math.max(0, remaining);
}
