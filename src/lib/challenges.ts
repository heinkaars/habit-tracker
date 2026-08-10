/**
 * A challenge is a fixed-length commitment to one habit, starting the day it's
 * accepted. It is the app's first reward beat: onboarding hands the user a
 * 3-day challenge so there's a finish line in sight before motivation fades.
 */

import { addDays, dayKey, isComplete, parseDayKey, type Habit } from '@/lib/habits';

export type Challenge = {
  id: string;
  habitId: string;
  /** User-supplied title. Falls back to "<n>-day challenge" when blank. */
  name: string;
  lengthDays: number;
  /** Day key of day one. */
  startedAt: string;
  /** Day key the final day was completed, or null while in progress. */
  completedAt: string | null;
};

export const DEFAULT_CHALLENGE_DAYS = 3;
export const MIN_CHALLENGE_DAYS = 1;
export const MAX_CHALLENGE_DAYS = 365;

export function clampLength(days: number): number {
  if (!Number.isFinite(days)) return DEFAULT_CHALLENGE_DAYS;
  return Math.min(MAX_CHALLENGE_DAYS, Math.max(MIN_CHALLENGE_DAYS, Math.round(days)));
}

export function createChallenge(
  habitId: string,
  lengthDays: number = DEFAULT_CHALLENGE_DAYS,
  name = '',
  today: Date = new Date(),
): Challenge {
  const length = clampLength(lengthDays);

  return {
    id: `challenge-${Date.now()}`,
    habitId,
    name: name.trim() || `${length}-day challenge`,
    lengthDays: length,
    startedAt: dayKey(today),
    completedAt: null,
  };
}

/** Older stored challenges predate `name`. */
export function challengeTitle(challenge: Challenge): string {
  return challenge.name?.trim() || `${challenge.lengthDays}-day challenge`;
}

/** Dev-only: move day one, so a long challenge can be tested without waiting. */
export function shiftStart(challenge: Challenge, deltaDays: number): Challenge {
  const start = addDays(parseDayKey(challenge.startedAt), deltaDays);

  return { ...challenge, startedAt: dayKey(start), completedAt: null };
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
