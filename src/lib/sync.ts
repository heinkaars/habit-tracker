/**
 * Local-first sync between the AsyncStorage state and Supabase.
 *
 * The rule the whole file rests on:
 *
 *   **Remote is authoritative, except where a pending local op exists.**
 *
 * `pending` holds exactly the edits this device has made but not yet pushed.
 * Anything *not* in it has already been pushed, so a newer remote value for it
 * must have come from another device and should win. That gives last-write-wins
 * without stamping every habit and every day-cell with its own `updatedAt`, and
 * without the log ever changing shape.
 *
 * A check-in tap must never await any of this. Mutations enqueue an op and
 * return; `sync()` runs on its own schedule and is safe to lose — an op that
 * fails to push stays pending and wins the next round.
 */

import type {
  ChallengeRow,
  CheckInRow,
  HabitRow,
  ProfileRow,
} from '@/lib/database.types';
import type { Challenge } from '@/lib/challenges';
import type { Habit } from '@/lib/habits';
import type { Client } from '@/lib/supabase';

/** Account-level settings. Mirrors `Settings` in use-habits, minus nothing. */
export type SyncSettings = {
  onboarded: boolean;
  sound: boolean;
  haptics: boolean;
  remindersEnabled: boolean;
};

export type SyncState = {
  habits: Habit[];
  challenge: Challenge | null;
  settings: SyncSettings;
};

/**
 * One un-pushed local edit. `at` is when the user made it, and becomes the
 * row's `updated_at` — so ordering reflects the edit, not the reconnect.
 */
export type PendingOp =
  | { kind: 'habit'; id: string; at: string }
  | { kind: 'checkin'; habitId: string; day: string; at: string }
  | { kind: 'challenge'; id: string; at: string }
  | { kind: 'settings'; at: string };

export function pendingKey(op: PendingOp): string {
  switch (op.kind) {
    case 'habit':
      return `habit:${op.id}`;
    case 'checkin':
      return `checkin:${op.habitId}:${op.day}`;
    case 'challenge':
      return `challenge:${op.id}`;
    case 'settings':
      return 'settings';
  }
}

/**
 * Collapses repeated edits to the same thing, keeping the latest timestamp.
 * Tapping a habit four times should push one row, not four.
 */
export function enqueue(pending: PendingOp[], op: PendingOp): PendingOp[] {
  const key = pendingKey(op);
  const rest = pending.filter((existing) => pendingKey(existing) !== key);

  return [...rest, op];
}

/** Every local row, for the first push into an empty account. */
export function allOps(state: SyncState, at = new Date().toISOString()): PendingOp[] {
  const ops: PendingOp[] = [{ kind: 'settings', at }];

  for (const habit of state.habits) {
    ops.push({ kind: 'habit', id: habit.id, at });
    for (const day of Object.keys(habit.log)) {
      ops.push({ kind: 'checkin', habitId: habit.id, day, at });
    }
  }

  if (state.challenge) {
    ops.push({ kind: 'challenge', id: state.challenge.id, at });
  }

  return ops;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function toHabitRow(habit: Habit, userId: string, at: string): HabitRow {
  return {
    id: habit.id,
    user_id: userId,
    name: habit.name,
    emoji: habit.emoji,
    kind: habit.kind,
    target: habit.target,
    created_at: habit.createdAt,
    reminder_time: habit.reminderTime,
    deleted_at: habit.deletedAt,
    updated_at: at,
  };
}

function fromHabitRow(row: HabitRow, log: Record<string, number>): Habit {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    kind: row.kind,
    target: row.target,
    createdAt: row.created_at,
    reminderTime: row.reminder_time,
    deletedAt: row.deleted_at,
    log,
  };
}

function toChallengeRow(challenge: Challenge, userId: string, at: string): ChallengeRow {
  return {
    id: challenge.id,
    user_id: userId,
    habit_id: challenge.habitId,
    name: challenge.name,
    length_days: challenge.lengthDays,
    started_at: challenge.startedAt,
    completed_at: challenge.completedAt,
    deleted_at: challenge.deletedAt,
    updated_at: at,
  };
}

function fromChallengeRow(row: ChallengeRow): Challenge {
  return {
    id: row.id,
    habitId: row.habit_id,
    name: row.name,
    lengthDays: row.length_days,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    deletedAt: row.deleted_at,
  };
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Drains `pending` into Supabase. Returns the ops that did *not* land, so the
 * caller can keep them queued — a failed push must not look like a success, or
 * the next pull will overwrite the edit it failed to save.
 */
export async function pushPending(
  client: Client,
  userId: string,
  state: SyncState,
  pending: PendingOp[],
): Promise<PendingOp[]> {
  if (pending.length === 0) return [];

  const byId = new Map(state.habits.map((habit) => [habit.id, habit]));

  const habitOps = pending.filter((op) => op.kind === 'habit');
  const checkinOps = pending.filter((op) => op.kind === 'checkin');
  const challengeOps = pending.filter((op) => op.kind === 'challenge');
  const settingsOps = pending.filter((op) => op.kind === 'settings');

  const failed: PendingOp[] = [];

  // Habits go first: check-ins and challenges have a foreign key onto them, and
  // a check-in for a habit the server has never seen is rejected outright.
  const habitRows = habitOps
    .map((op) => {
      const habit = byId.get(op.id);
      return habit ? toHabitRow(habit, userId, op.at) : null;
    })
    .filter((row): row is HabitRow => row !== null);

  let habitsLanded = true;
  if (habitRows.length > 0) {
    const { error } = await client.from('habits').upsert(habitRows);
    if (error) {
      habitsLanded = false;
      failed.push(...habitOps);
    }
  }

  if (habitsLanded) {
    const checkInRows = checkinOps
      .map((op) => {
        const habit = byId.get(op.habitId);
        if (!habit) return null;

        return {
          habit_id: op.habitId,
          user_id: userId,
          day: op.day,
          // An absent key is a real value: zero. See the migration.
          count: habit.log[op.day] ?? 0,
          updated_at: op.at,
        } satisfies CheckInRow;
      })
      .filter((row): row is CheckInRow => row !== null);

    if (checkInRows.length > 0) {
      const { error } = await client.from('check_ins').upsert(checkInRows);
      if (error) failed.push(...checkinOps);
    }

    const challengeRows = challengeOps
      .map((op) =>
        state.challenge && state.challenge.id === op.id
          ? toChallengeRow(state.challenge, userId, op.at)
          : null,
      )
      .filter((row): row is ChallengeRow => row !== null);

    if (challengeRows.length > 0) {
      const { error } = await client.from('challenges').upsert(challengeRows);
      if (error) failed.push(...challengeOps);
    }
  } else {
    // Nothing that depends on a habit row can land if the habits didn't.
    failed.push(...checkinOps, ...challengeOps);
  }

  if (settingsOps.length > 0) {
    const at = settingsOps[settingsOps.length - 1].at;
    const { error } = await client.from('profiles').upsert({
      id: userId,
      onboarded: state.settings.onboarded,
      sound: state.settings.sound,
      haptics: state.settings.haptics,
      reminders_enabled: state.settings.remindersEnabled,
      updated_at: at,
    } satisfies ProfileRow);

    if (error) failed.push(...settingsOps);
  }

  return failed;
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

export type RemoteSnapshot = {
  habits: HabitRow[];
  checkIns: CheckInRow[];
  challenges: ChallengeRow[];
  profile: ProfileRow | null;
  /** Highest `updated_at` seen, to use as the next `since`. */
  watermark: string | null;
};

/**
 * Fetches everything changed since `since`, or everything when it's null.
 *
 * The watermark is the newest `updated_at` in the response rather than the
 * device clock — clock skew between a phone and Postgres would otherwise skip
 * rows permanently. Re-fetching the boundary row on each pull is the price, and
 * applying it twice is a no-op.
 */
export async function pullSince(
  client: Client,
  userId: string,
  since: string | null,
): Promise<RemoteSnapshot> {
  const scope = <T>(query: T & { gte: (col: string, value: string) => T }): T =>
    since ? query.gte('updated_at', since) : query;

  const [habits, checkIns, challenges, profile] = await Promise.all([
    scope(client.from('habits').select('*').eq('user_id', userId)),
    scope(client.from('check_ins').select('*').eq('user_id', userId)),
    scope(client.from('challenges').select('*').eq('user_id', userId)),
    client.from('profiles').select('*').eq('id', userId).maybeSingle(),
  ]);

  const error = habits.error ?? checkIns.error ?? challenges.error ?? profile.error;
  if (error) throw error;

  const stamps = [
    ...(habits.data ?? []).map((row) => row.updated_at),
    ...(checkIns.data ?? []).map((row) => row.updated_at),
    ...(challenges.data ?? []).map((row) => row.updated_at),
  ];

  return {
    habits: habits.data ?? [],
    checkIns: checkIns.data ?? [],
    challenges: challenges.data ?? [],
    profile: profile.data ?? null,
    watermark: stamps.length > 0 ? stamps.reduce((a, b) => (a > b ? a : b)) : null,
  };
}

/**
 * Folds a snapshot into local state, skipping anything with a pending local
 * edit. Pure — the caller decides what to do with the result.
 */
export function applyRemote(
  state: SyncState,
  snapshot: RemoteSnapshot,
  pending: PendingOp[],
): SyncState {
  const held = new Set(pending.map(pendingKey));

  const habits = new Map(state.habits.map((habit) => [habit.id, habit]));

  for (const row of snapshot.habits) {
    if (held.has(`habit:${row.id}`)) continue;
    habits.set(row.id, fromHabitRow(row, habits.get(row.id)?.log ?? {}));
  }

  for (const row of snapshot.checkIns) {
    if (held.has(`checkin:${row.habit_id}:${row.day}`)) continue;

    const habit = habits.get(row.habit_id);
    if (!habit) continue;

    const log = { ...habit.log };
    // Zero is how the remote spells "no longer logged".
    if (row.count > 0) {
      log[row.day] = row.count;
    } else {
      delete log[row.day];
    }

    habits.set(habit.id, { ...habit, log });
  }

  // The app shows one challenge at a time: the newest live one.
  let challenge = state.challenge;
  for (const row of snapshot.challenges) {
    if (held.has(`challenge:${row.id}`)) continue;

    const incoming = fromChallengeRow(row);
    if (!challenge || challenge.id === incoming.id || incoming.startedAt >= challenge.startedAt) {
      challenge = incoming;
    }
  }

  const settings =
    snapshot.profile && !held.has('settings')
      ? {
          // Sticky: a profile row that hasn't caught up yet must not bounce a
          // user who is already using the app back into onboarding.
          onboarded: state.settings.onboarded || snapshot.profile.onboarded,
          sound: snapshot.profile.sound,
          haptics: snapshot.profile.haptics,
          remindersEnabled: snapshot.profile.reminders_enabled,
        }
      : state.settings;

  return { habits: [...habits.values()], challenge, settings };
}
