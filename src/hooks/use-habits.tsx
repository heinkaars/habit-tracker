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
import { rescheduleReminders } from '@/lib/notifications';

const STORAGE_KEY = 'habit-tracker.state.v2';
const LEGACY_KEY = 'habit-tracker.habits.v1';

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

type HabitsContextValue = State & {
  loading: boolean;
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

/**
 * Stored state predates `reminderTime` and challenge `name`. Both are additive,
 * so existing data is filled in on read rather than being stranded behind a new
 * storage key — nothing already saved is reinterpreted.
 */
function normalize(state: State): State {
  return {
    habits: (state.habits ?? []).map((habit) => ({
      ...habit,
      reminderTime: habit.reminderTime ?? null,
    })),
    challenge: state.challenge
      ? {
          ...state.challenge,
          name: state.challenge.name ?? `${state.challenge.lengthDays}-day challenge`,
        }
      : null,
    settings: { ...DEFAULT_SETTINGS, ...(state.settings ?? {}) },
  };
}

function initialState(): State {
  return { habits: seedHabits(), challenge: null, settings: DEFAULT_SETTINGS };
}

export function HabitsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => ({
    habits: [],
    challenge: null,
    settings: DEFAULT_SETTINGS,
  }));
  const [loading, setLoading] = useState(true);

  // Latest state for effects that must not re-run on every keystroke.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<State> {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw) as State);

      // Read forward from the pre-challenge, pre-habit-kinds shape.
      const legacy = await AsyncStorage.getItem(LEGACY_KEY);
      if (legacy) {
        return {
          habits: migrateV1(JSON.parse(legacy)),
          challenge: null,
          settings: { ...DEFAULT_SETTINGS, onboarded: true },
        };
      }

      return initialState();
    }

    load()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(() => {
        // A corrupt store shouldn't wedge the app on a spinner.
        if (!cancelled) setState(initialState());
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

  // Reminder times live on habits now, so the schedule tracks the habit list.
  const reminderSignature = state.habits
    .map((habit) => `${habit.id}:${habit.reminderTime ?? ''}:${habit.emoji}${habit.name}`)
    .join('|');

  useEffect(() => {
    if (loading) return;
    rescheduleReminders({
      enabled: stateRef.current.settings.remindersEnabled,
      habits: stateRef.current.habits,
    });
  }, [loading, state.settings.remindersEnabled, reminderSignature]);

  const step = useCallback((habitId: string): StepOutcome => {
    const today = dayKey();
    const current = stateRef.current;
    const habit = current.habits.find((item) => item.id === habitId);
    if (!habit) return 'progress';

    const wasComplete = isComplete(habit, today);
    const updated = logStep(habit, today);
    const nowComplete = isComplete(updated, today);

    const habits = current.habits.map((item) => (item.id === habitId ? updated : item));

    // A challenge only resolves once, on the tap that fulfils its final day.
    let challenge = current.challenge;
    let fulfilledNow = false;
    if (challenge && challenge.habitId === habitId && !challenge.completedAt) {
      if (isFulfilled(challenge, updated)) {
        challenge = { ...challenge, completedAt: today };
        fulfilledNow = true;
      }
    }

    setState({ ...current, habits, challenge });

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
    setState((current) => ({ ...current, habits: [...current.habits, habit] }));

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
    }));
  }, []);

  const remove = useCallback((habitId: string) => {
    setState((current) => ({
      ...current,
      habits: current.habits.filter((habit) => habit.id !== habitId),
      // Don't leave a challenge pointing at a habit that no longer exists.
      challenge: current.challenge?.habitId === habitId ? null : current.challenge,
    }));
  }, []);

  const startChallenge = useCallback((habitId: string, lengthDays?: number, name?: string) => {
    setState((current) => ({
      ...current,
      challenge: createChallenge(habitId, lengthDays, name),
    }));
  }, []);

  const dismissChallenge = useCallback(() => {
    setState((current) => ({ ...current, challenge: null }));
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setState((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
  }, []);

  const resetToDemo = useCallback(() => {
    setState({
      habits: seedHabits(),
      challenge: null,
      settings: { ...DEFAULT_SETTINGS, onboarded: true },
    });
  }, []);

  const devShiftChallenge = useCallback((deltaDays: number) => {
    setState((current) =>
      current.challenge
        ? { ...current, challenge: shiftStart(current.challenge, deltaDays) }
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
      const { challenge } = current;
      if (!challenge) return current;

      const days = challengeDays(challenge);
      const fill = leaveLastDayOpen ? days.slice(0, -1) : days;

      return {
        ...current,
        challenge: leaveLastDayOpen ? { ...challenge, completedAt: null } : challenge,
        habits: current.habits.map((habit) =>
          habit.id === challenge.habitId
            ? {
                ...habit,
                log: {
                  ...habit.log,
                  ...Object.fromEntries(fill.map((key) => [key, habit.target])),
                },
              }
            : habit,
        ),
      };
    });
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      loading,
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
      state,
      loading,
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
