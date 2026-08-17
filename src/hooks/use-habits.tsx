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
  recentDays,
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
  /**
   * IANA name, e.g. "America/New_York" — captured from the device, not user-
   * facing. Lets the scheduled coach-note sweep know what "morning" means for
   * this account without needing them to have opened the app that day.
   */
  timezone: string | null;
};

const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  sound: true,
  haptics: true,
  remindersEnabled: false,
  timezone: null,
};

/**
 * Mirrors the `profiles_timezone_shape` constraint in
 * `0008_bound_timezone.sql`, which bounds this column because the coach-cadence
 * sweep reads it across every account at once.
 *
 * Same arrangement as `sign-in.tsx` restating `minimum_password_length`: the
 * database is the control, this is what keeps a rejected value from becoming a
 * settings op that stays pending and retries forever. The two have to move
 * together — loosen one and the other silently starts failing.
 */
function isPlausibleTimezone(value: string): boolean {
  return value.length <= 64 && /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(value);
}

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
  resetData: () => void;
  /** Dev-only helpers, surfaced in Settings behind __DEV__. */
  devShiftChallenge: (deltaDays: number) => void;
  devFillChallenge: (leaveLastDayOpen: boolean) => void;
  devSimulateHistory: (days: number, mode: 'full' | 'mixed') => void;
  devSimulateFullChallenge: () => void;
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

/**
 * Whether a blank slate should be filled with the demo habits.
 *
 * The seed exists so the app is explorable the moment it opens — Today has
 * rows, Insights has a chart, streaks exist — and that is worth keeping for the
 * no-project mode, where there is no account to hold real data and the web
 * preview and a fresh clone are the whole audience.
 *
 * With a project configured it is actively wrong. Every user now signs in
 * (see `requiresSignIn` in `use-auth.tsx`), and first contact with an empty
 * account pushes local state up wholesale — so the seed's two weeks of
 * backdated check-ins land in a real account as if the user had done them.
 * That is the "demo seed grafted onto a real account" case the sync rules exist
 * to prevent, arriving by a different door. It also defeats the AI spend guard:
 * `MIN_ACTIVE_DAYS` counts distinct days in `check_ins`, so a day-old account
 * clears the history threshold on fabricated rows and the coach writes about
 * habits the user never had.
 *
 * Evaluated per call rather than captured at import: `supabase` is constructed
 * at module load and this keeps the two from depending on import order.
 */
function demoSeedAllowed(): boolean {
  return supabase === null;
}

function freshState(): State {
  return {
    // Empty is a supported state, not a broken one — Today, Insights and
    // Challenge all render their own empty copy, and onboarding puts the user's
    // first real habit in immediately after.
    habits: demoSeedAllowed() ? seedHabits() : [],
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

      // First contact with an account: adopt it wholesale — including adopting
      // its emptiness.
      //
      // This used to *claim* an empty account instead, pushing whatever was on
      // the device up into it. That made sense when habits could be created
      // before signing in. Under auth-required they can't, so anything sitting
      // here at first contact is one of two things, and neither belongs to this
      // account: a demo seed left by an install that predates `demoSeedAllowed`,
      // or the previous account's cache still on a shared device. Claiming
      // pushed both into the new account — fabricated history that also cleared
      // the AI features' `MIN_ACTIVE_DAYS` floor in the first case, and one
      // user's habits landing in another's account in the second.
      if (current.accountId !== userId) {
        const snapshot = await pullSince(client, userId, null);

        const adopted = applyRemote(
          // DEFAULT_SETTINGS, not the device's. `onboarded` is a fact about the
          // account, and `applyRemote` keeps it sticky (`local || remote`) so a
          // profile that hasn't caught up can't bounce an active user back into
          // onboarding. Seeding that from the device would carry a stale `true`
          // into a brand-new account and skip onboarding for its first user.
          { habits: [], challenge: null, settings: DEFAULT_SETTINGS },
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

  // Keeps the stored timezone matched to the device's, so the scheduled
  // coach-note sweep can compute the right local day for this account. Gated
  // on `loading`: calling this before storage has finished loading would
  // apply the update to the still-default state, which the load() effect then
  // overwrites a moment later. Not re-checked on every foreground — a
  // reinstall or app restart after changing timezone (e.g. travel) re-runs
  // it; a still-running app doesn't notice mid-session, which is an accepted
  // gap for a habit tracker rather than something worth polling for.
  useEffect(() => {
    if (loading) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // A runtime that returns something the database won't accept is skipped
    // rather than stored: the sweep already treats a null timezone as "not
    // synced yet" and simply passes over that profile, whereas a rejected
    // upsert would leave the settings op pending and retrying indefinitely.
    if (tz && isPlausibleTimezone(tz) && tz !== stateRef.current.settings.timezone) {
      updateSettings({ timezone: tz });
    }
  }, [loading, updateSettings]);

  /**
   * Starts over. Reseeds the demo habits only where the seed belongs at all
   * (see `demoSeedAllowed`) — with a project configured this clears and stops,
   * because pushing fabricated history into the signed-in account is the thing
   * the seed rule exists to prevent. Settings labels the button to match.
   */
  const resetData = useCallback(() => {
    setState((current) => {
      const at = now();
      // Tombstone what's there so the reset reaches other devices instead of
      // leaving orphans behind on the server.
      const buried = current.habits.map((habit) => ({ ...habit, deletedAt: habit.deletedAt ?? at }));
      const seeded = demoSeedAllowed() ? seedHabits() : [];

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

  /**
   * Backfills the last `days` days across every live habit, so streaks,
   * rates, and the AI features can be tested against something that looks
   * like real usage instead of a fresh install. 'full' completes every day;
   * 'mixed' hits target on roughly half the days and leaves the rest partial
   * or empty, the way a real account looks after a few imperfect weeks.
   */
  const devSimulateHistory = useCallback((days: number, mode: 'full' | 'mixed') => {
    setState((current) => {
      const at = now();
      const keys = recentDays(days);
      const ops: PendingOp[] = [];

      const nextHabits = current.habits.map((habit) => {
        if (habit.deletedAt) return habit;

        const log = { ...habit.log };
        for (const key of keys) {
          const hit = mode === 'full' || Math.random() < 0.5;
          const value = hit ? habit.target : Math.floor(Math.random() * habit.target);

          if (value > 0) {
            log[key] = value;
          } else {
            delete log[key];
          }
          ops.push({ kind: 'checkin', habitId: habit.id, day: key, at });
        }

        return { ...habit, log };
      });

      return { ...current, habits: nextHabits, pending: queue(current, ops) };
    });
  }, []);

  /**
   * Completes a challenge end to end: starts one on the first live habit if
   * none is active, then fills every day and stamps `completedAt`. Unlike
   * `devFillChallenge(false)`, which only fills the log, this leaves the
   * challenge in the same state a real final tap would — so the Today banner
   * and Challenge screen read as genuinely finished, not just fully logged.
   */
  const devSimulateFullChallenge = useCallback(() => {
    setState((current) => {
      const liveHabits = current.habits.filter((habit) => !habit.deletedAt);
      if (liveHabits.length === 0) return current;

      const active = current.challenge && !current.challenge.deletedAt ? current.challenge : null;
      const target = active ?? createChallenge(liveHabits[0].id, 7, 'Simulated challenge');
      const days = challengeDays(target);
      const completed: Challenge = { ...target, completedAt: days[days.length - 1] };

      const at = now();
      const ops: PendingOp[] = [
        { kind: 'challenge', id: completed.id, at },
        ...days.map((day) => ({ kind: 'checkin' as const, habitId: completed.habitId, day, at })),
      ];

      return {
        ...current,
        challenge: completed,
        habits: current.habits.map((habit) =>
          habit.id === completed.habitId
            ? {
                ...habit,
                log: { ...habit.log, ...Object.fromEntries(days.map((key) => [key, habit.target])) },
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
      resetData,
      devShiftChallenge,
      devFillChallenge,
      devSimulateHistory,
      devSimulateFullChallenge,
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
      resetData,
      devShiftChallenge,
      devFillChallenge,
      devSimulateHistory,
      devSimulateFullChallenge,
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
