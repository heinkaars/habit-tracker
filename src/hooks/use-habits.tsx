import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/hooks/use-auth';
import {
  challengeDays,
  createChallenge,
  isFulfilled,
  shiftStart,
  type Challenge,
} from '@/lib/challenges';
import {
  feedbackChallenge,
  feedbackComplete,
  feedbackStep,
  feedbackUndo,
  setFeedbackPrefs,
} from '@/lib/feedback';
import {
  createHabit,
  dayKey,
  isComplete,
  logStep,
  migrateV1,
  seedHabits,
  type Habit,
  type HabitKind,
} from '@/lib/habits';
import { newId } from '@/lib/ids';
import { rescheduleReminders } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import {
  allOps,
  applyRemote,
  enqueue,
  pullSince,
  pushPending,
  type PendingOp,
  type SyncState,
} from '@/lib/sync';

// v3 renamed nothing, but it re-issues every id as a UUID — that reinterprets
// stored data rather than adding to it, so it needs its own key and a forward
// read. v2 is deliberately left in place as a fallback; users have real history
// on device and a bad migration should be recoverable.
const STORAGE_KEY = 'habit-tracker.state.v3';
const V2_KEY = 'habit-tracker.state.v2';
const V1_KEY = 'habit-tracker.habits.v1';

export type Settings = {
  onboarded: boolean;
  sound: boolean;
  haptics: boolean;
  remindersEnabled: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  sound: true,
  haptics: true,
  remindersEnabled: false,
};

type State = {
  habits: Habit[];
  challenge: Challenge | null;
  settings: Settings;
  /** Local edits not yet pushed. See `lib/sync.ts` for why this is the merge key. */
  pending: PendingOp[];
  /** Watermark for the next delta pull. */
  lastPulledAt: string | null;
  /** Account this local state belongs to, so a switch triggers a fresh sync. */
  accountId: string | null;
};

/** Fields a habit can be edited to. */
export type HabitDraft = {
  name: string;
  emoji: string;
  kind: HabitKind;
  target: number;
  reminderTime: string | null;
};

/** What a tap produced, so the screen knows which celebration to show. */
export type StepOutcome = 'progress' | 'complete' | 'undo' | 'challenge';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'pending' | 'error';

type HabitsContextValue = {
  habits: Habit[];
  challenge: Challenge | null;
  settings: Settings;
  loading: boolean;
  syncStatus: SyncStatus;
  step: (habitId: string) => StepOutcome;
  add: (draft: HabitDraft) => Habit;
  update: (habitId: string, draft: HabitDraft) => void;
  remove: (habitId: string) => void;
  startChallenge: (habitId: string, lengthDays?: number, name?: string) => void;
  dismissChallenge: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetToDemo: () => void;
  /** Dev-only helpers, surfaced in Settings behind __DEV__. */
  devShiftChallenge: (deltaDays: number) => void;
  devFillChallenge: (leaveLastDayOpen: boolean) => void;
};

const HabitsContext = createContext<HabitsContextValue | null>(null);

const now = () => new Date().toISOString();

/**
 * Queues ops, but only once there's an account to push them to.
 *
 * Signed out, the queue would grow for the life of the install and then be
 * thrown away regardless: first contact with an account either adopts the
 * remote wholesale or claims it with `allOps`, and neither reads `pending`.
 */
function queue(current: State, ops: PendingOp[]): PendingOp[] {
  if (!current.accountId) return current.pending;

  return ops.reduce(enqueue, current.pending);
}

/** The subset `lib/sync` cares about. */
function syncView(state: State): SyncState {
  return { habits: state.habits, challenge: state.challenge, settings: state.settings };
}

/**
 * Additive fields are filled in on read rather than stranded behind a new
 * storage key — nothing already saved is reinterpreted.
 */
function normalize(state: State): State {
  return {
    habits: (state.habits ?? []).map((habit) => ({
      ...habit,
      reminderTime: habit.reminderTime ?? null,
      deletedAt: habit.deletedAt ?? null,
    })),
    challenge: state.challenge
      ? {
          ...state.challenge,
          name: state.challenge.name ?? `${state.challenge.lengthDays}-day challenge`,
          deletedAt: state.challenge.deletedAt ?? null,
        }
      : null,
    settings: { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) },
    pending: state.pending ?? [],
    lastPulledAt: state.lastPulledAt ?? null,
    accountId: state.accountId ?? null,
  };
}

/**
 * v2 → v3. Ids were `seed-0` or `Date.now()`-derived; both collide across users
 * once rows share a table, so every id is re-issued as a UUID. The challenge's
 * `habitId` is remapped through the same table, or it would point at nothing.
 */
function migrateV2(state: State): State {
  const remap = new Map(state.habits.map((habit) => [habit.id, newId()]));

  return normalize({
    ...state,
    habits: state.habits.map((habit) => ({ ...habit, id: remap.get(habit.id) ?? newId() })),
    challenge: state.challenge
      ? {
          ...state.challenge,
          id: newId(),
          habitId: remap.get(state.challenge.habitId) ?? state.challenge.habitId,
        }
      : null,
    pending: [],
    lastPulledAt: null,
    accountId: null,
  });
}

function freshState(): State {
  return {
    habits: seedHabits(),
    challenge: null,
    settings: DEFAULT_SETTINGS,
    pending: [],
    lastPulledAt: null,
    accountId: null,
  };
}

export function HabitsProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>(() => ({
    habits: [],
    challenge: null,
    settings: DEFAULT_SETTINGS,
    pending: [],
    lastPulledAt: null,
    accountId: null,
  }));
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);

  // Latest state for effects that must not re-run on every keystroke.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<State> {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw) as State);

      const v2 = await AsyncStorage.getItem(V2_KEY);
      if (v2) return migrateV2(normalize(JSON.parse(v2) as State));

      // Read forward from the pre-challenge, pre-habit-kinds shape.
      const legacy = await AsyncStorage.getItem(V1_KEY);
      if (legacy) {
        return migrateV2({
          habits: migrateV1(JSON.parse(legacy)),
          challenge: null,
          settings: { ...DEFAULT_SETTINGS, onboarded: true },
          pending: [],
          lastPulledAt: null,
          accountId: null,
        });
      }

      return freshState();
    }

    load()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        // A corrupt store shouldn't wedge the app on a spinner.
        if (!cancelled) setState(freshState());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Skip the initial render so we don't overwrite storage before it loads.
    if (loading) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, loading]);

  useEffect(() => {
    setFeedbackPrefs({ sound: state.settings.sound, haptics: state.settings.haptics });
  }, [state.settings.sound, state.settings.haptics]);

  // Screens never see a tombstoned row; sync does.
  const habits = useMemo(() => state.habits.filter((habit) => !habit.deletedAt), [state.habits]);
  const challenge = state.challenge?.deletedAt ? null : state.challenge;

  // Reminder times live on habits now, so the schedule tracks the habit list.
  const reminderSignature = habits
    .map((habit) => `${habit.id}:${habit.reminderTime ?? ''}:${habit.emoji}${habit.name}`)
    .join('|');

  useEffect(() => {
    if (loading) return;
    rescheduleReminders({
      enabled: stateRef.current.settings.remindersEnabled,
      // Deleted habits must stop notifying, so this uses the visible list.
      habits: stateRef.current.habits.filter((habit) => !habit.deletedAt),
    });
  }, [loading, state.settings.remindersEnabled, reminderSignature]);

  // -------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------

  const syncingRef = useRef(false);

  /**
   * Push local edits, then pull remote ones. Never awaited by a mutation — a
   * check-in has to land in the same frame as the tap.
   */
  const sync = useCallback(async () => {
    const client = supabase;
    const userId = user?.id;
    if (!client || !userId || syncingRef.current) return;

    syncingRef.current = true;
    setSyncing(true);

    try {
      const current = stateRef.current;

      // First contact with an account: adopt what's already there, or claim it
      // with what's on this device. Merging the two would silently graft demo
      // seed data onto a real account.
      if (current.accountId !== userId) {
        const snapshot = await pullSince(client, userId, null);

        if (snapshot.habits.length > 0) {
          const adopted = applyRemote(
            { habits: [], challenge: null, settings: current.settings },
            snapshot,
            [],
          );

          setState((prev) => ({
            ...prev,
            ...adopted,
            pending: [],
            lastPulledAt: snapshot.watermark,
            accountId: userId,
          }));
        } else {
          const ops = allOps(syncView(current));
          const failed = await pushPending(client, userId, syncView(current), ops);

          setState((prev) => ({
            ...prev,
            pending: failed,
            lastPulledAt: snapshot.watermark,
            accountId: userId,
          }));
        }

        setSyncError(false);
        return;
      }

      const failed = await pushPending(client, userId, syncView(current), current.pending);
      const snapshot = await pullSince(client, userId, current.lastPulledAt);

      setState((prev) => {
        // `prev` may already hold edits made while the request was in flight;
        // those ops are still in `prev.pending` and so still win the merge.
        const stillPending = [
          ...failed,
          ...prev.pending.filter((op) => !current.pending.includes(op)),
        ];

        return {
          ...prev,
          ...applyRemote(syncView(prev), snapshot, stillPending),
          pending: stillPending,
          lastPulledAt: snapshot.watermark ?? prev.lastPulledAt,
        };
      });

      setSyncError(false);
    } catch {
      // Offline is the common case, not an exception. Ops stay pending.
      setSyncError(true);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [user?.id]);

  // Sync when the account changes, and whenever work is waiting. Debounced so a
  // burst of taps produces one round-trip rather than one each.
  useEffect(() => {
    if (loading || authLoading || !user?.id) return;

    const timer = setTimeout(sync, 800);
    return () => clearTimeout(timer);
  }, [loading, authLoading, user?.id, state.pending.length, state.accountId, sync]);

  // Pull on foreground: another device may have moved while this one slept.
  useEffect(() => {
    if (!user?.id) return;

    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'active') sync();
    });

    return () => subscription.remove();
  }, [user?.id, sync]);

  const syncStatus: SyncStatus = !supabase || !user
    ? 'off'
    : syncing
      ? 'syncing'
      : syncError
        ? 'error'
        : state.pending.length > 0
          ? 'pending'
          : 'idle';

  // -------------------------------------------------------------------------
  // Mutations. Each one updates local state and enqueues an op; neither waits
  // on the network.
  // -------------------------------------------------------------------------

  const step = useCallback((habitId: string): StepOutcome => {
    const today = dayKey();
    const current = stateRef.current;
    const habit = current.habits.find((item) => item.id === habitId);
    if (!habit || habit.deletedAt) return 'progress';

    const wasComplete = isComplete(habit, today);
    const updated = logStep(habit, today);
    const nowComplete = isComplete(updated, today);

    const nextHabits = current.habits.map((item) => (item.id === habitId ? updated : item));

    const at = now();
    const ops: PendingOp[] = [{ kind: 'checkin', habitId, day: today, at }];

    // A challenge only resolves once, on the tap that fulfils its final day.
    let nextChallenge = current.challenge;
    let fulfilledNow = false;
    if (nextChallenge && nextChallenge.habitId === habitId && !nextChallenge.completedAt) {
      if (isFulfilled(nextChallenge, updated)) {
        nextChallenge = { ...nextChallenge, completedAt: today };
        fulfilledNow = true;
        ops.push({ kind: 'challenge', id: nextChallenge.id, at });
      }
    }

    setState({
      ...current,
      habits: nextHabits,
      challenge: nextChallenge,
      pending: queue(current, ops),
    });

    if (fulfilledNow) {
      feedbackChallenge();
      return 'challenge';
    }
    if (!wasComplete && nowComplete) {
      feedbackComplete();
      return 'complete';
    }
    if (wasComplete && !nowComplete) {
      feedbackUndo();
      return 'undo';
    }

    feedbackStep();
    return 'progress';
  }, []);

  const add = useCallback((draft: HabitDraft) => {
    const habit = createHabit(draft.name, draft.emoji, draft.kind, draft.target, draft.reminderTime);

    setState((current) => ({
      ...current,
      habits: [...current.habits, habit],
      pending: queue(current, [{ kind: 'habit', id: habit.id, at: now() }]),
    }));

    return habit;
  }, []);

  const update = useCallback((habitId: string, draft: HabitDraft) => {
    setState((current) => ({
      ...current,
      habits: current.habits.map((habit) =>
        habit.id === habitId
          ? {
              ...habit,
              name: draft.name.trim() || habit.name,
              emoji: draft.emoji,
              kind: draft.kind,
              target: draft.kind === 'binary' ? 1 : Math.max(2, Math.round(draft.target)),
              reminderTime: draft.reminderTime,
            }
          : habit,
      ),
      pending: queue(current, [{ kind: 'habit', id: habitId, at: now() }]),
    }));
  }, []);

  /** Tombstones rather than drops — see `Habit.deletedAt`. */
  const remove = useCallback((habitId: string) => {
    setState((current) => {
      const at = now();
      const ops: PendingOp[] = [{ kind: 'habit', id: habitId, at }];

      // Don't leave a challenge pointing at a habit that no longer exists.
      const orphaned = current.challenge?.habitId === habitId ? current.challenge : null;
      if (orphaned) ops.push({ kind: 'challenge', id: orphaned.id, at });

      return {
        ...current,
        habits: current.habits.map((habit) =>
          habit.id === habitId ? { ...habit, deletedAt: at } : habit,
        ),
        challenge: orphaned ? { ...orphaned, deletedAt: at } : current.challenge,
        pending: queue(current, ops),
      };
    });
  }, []);

  const startChallenge = useCallback((habitId: string, lengthDays?: number, name?: string) => {
    setState((current) => {
      const next = createChallenge(habitId, lengthDays, name);
      const at = now();
      const ops: PendingOp[] = [{ kind: 'challenge', id: next.id, at }];

      // The one being replaced still exists remotely; tombstone it explicitly.
      if (current.challenge && !current.challenge.deletedAt) {
        ops.push({ kind: 'challenge', id: current.challenge.id, at });
      }

      return { ...current, challenge: next, pending: queue(current, ops) };
    });
  }, []);

  const dismissChallenge = useCallback(() => {
    setState((current) => {
      if (!current.challenge) return current;

      const at = now();
      return {
        ...current,
        challenge: { ...current.challenge, deletedAt: at },
        pending: queue(current, [{ kind: 'challenge', id: current.challenge.id, at }]),
      };
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
      pending: queue(current, [{ kind: 'settings', at: now() }]),
    }));
  }, []);

  const resetToDemo = useCallback(() => {
    setState((current) => {
      const at = now();
      // Tombstone what's there so the reset reaches other devices instead of
      // leaving orphans behind on the server.
      const buried = current.habits.map((habit) => ({ ...habit, deletedAt: habit.deletedAt ?? at }));
      const seeded = seedHabits();

      const next: State = {
        ...current,
        habits: [...buried, ...seeded],
        challenge: current.challenge ? { ...current.challenge, deletedAt: at } : null,
        settings: { ...DEFAULT_SETTINGS, onboarded: true },
        pending: [],
      };

      return { ...next, pending: queue(current, allOps(syncView(next), at)) };
    });
  }, []);

  const devShiftChallenge = useCallback((deltaDays: number) => {
    setState((current) =>
      current.challenge
        ? {
            ...current,
            challenge: shiftStart(current.challenge, deltaDays),
            pending: queue(current, [
              { kind: 'challenge', id: current.challenge.id, at: now() },
            ]),
          }
        : current,
    );
  }, []);

  /**
   * Fills the challenge habit's log across the challenge window. Leaving the
   * last day open is the useful case: it puts the real completion event one
   * genuine tap away instead of faking it.
   */
  const devFillChallenge = useCallback((leaveLastDayOpen: boolean) => {
    setState((current) => {
      const active = current.challenge;
      if (!active) return current;

      const days = challengeDays(active);
      const fill = leaveLastDayOpen ? days.slice(0, -1) : days;
      const at = now();

      const ops: PendingOp[] = [
        { kind: 'challenge', id: active.id, at },
        ...fill.map((day) => ({ kind: 'checkin' as const, habitId: active.habitId, day, at })),
      ];

      return {
        ...current,
        challenge: leaveLastDayOpen ? { ...active, completedAt: null } : active,
        habits: current.habits.map((habit) =>
          habit.id === active.habitId
            ? {
                ...habit,
                log: {
                  ...habit.log,
                  ...Object.fromEntries(fill.map((key) => [key, habit.target])),
                },
              }
            : habit,
        ),
        pending: queue(current, ops),
      };
    });
  }, []);

  const value = useMemo(
    () => ({
      habits,
      challenge,
      settings: state.settings,
      loading,
      syncStatus,
      step,
      add,
      update,
      remove,
      startChallenge,
      dismissChallenge,
      updateSettings,
      resetToDemo,
      devShiftChallenge,
      devFillChallenge,
    }),
    [
      habits,
      challenge,
      state.settings,
      loading,
      syncStatus,
      step,
      add,
      update,
      remove,
      startChallenge,
      dismissChallenge,
      updateSettings,
      resetToDemo,
      devShiftChallenge,
      devFillChallenge,
    ],
  );

  return <HabitsContext value={value}>{children}</HabitsContext>;
}

export function useHabits(): HabitsContextValue {
  const context = use(HabitsContext);
  if (!context) {
    throw new Error('useHabits must be used inside a <HabitsProvider>');
  }

  return context;
}
