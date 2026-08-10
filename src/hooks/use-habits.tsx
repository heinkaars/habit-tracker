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
  createChallenge,
  isFulfilled,
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
import { DEFAULT_REMINDER_HOURS, rescheduleReminders } from '@/lib/notifications';

const STORAGE_KEY = 'habit-tracker.state.v2';
const LEGACY_KEY = 'habit-tracker.habits.v1';

export type Settings = {
  onboarded: boolean;
  sound: boolean;
  haptics: boolean;
  remindersEnabled: boolean;
  reminderHours: number[];
};

const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  sound: true,
  haptics: true,
  remindersEnabled: false,
  reminderHours: DEFAULT_REMINDER_HOURS,
};

type State = {
  habits: Habit[];
  challenge: Challenge | null;
  settings: Settings;
};

/** What a tap produced, so the screen knows which celebration to show. */
export type StepOutcome = 'progress' | 'complete' | 'undo' | 'challenge';

type HabitsContextValue = State & {
  loading: boolean;
  step: (habitId: string) => StepOutcome;
  add: (name: string, emoji: string, kind: HabitKind, target: number) => Habit;
  remove: (habitId: string) => void;
  startChallenge: (habitId: string, lengthDays?: number) => void;
  dismissChallenge: () => void;
  updateSettings: (patch: Partial<Settings>) => void;
  resetToDemo: () => void;
};

const HabitsContext = createContext<HabitsContextValue | null>(null);

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
      if (raw) return JSON.parse(raw) as State;

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

  useEffect(() => {
    if (loading) return;
    rescheduleReminders({
      enabled: state.settings.remindersEnabled,
      hours: state.settings.reminderHours,
      habits: stateRef.current.habits,
    });
    // Habit names only change reminder copy, so don't reschedule on every edit.
  }, [loading, state.settings.remindersEnabled, state.settings.reminderHours]);

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

  const add = useCallback((name: string, emoji: string, kind: HabitKind, target: number) => {
    const habit = createHabit(name, emoji, kind, target);
    setState((current) => ({ ...current, habits: [...current.habits, habit] }));

    return habit;
  }, []);

  const remove = useCallback((habitId: string) => {
    setState((current) => ({
      ...current,
      habits: current.habits.filter((habit) => habit.id !== habitId),
      // Don't leave a challenge pointing at a habit that no longer exists.
      challenge: current.challenge?.habitId === habitId ? null : current.challenge,
    }));
  }, []);

  const startChallenge = useCallback((habitId: string, lengthDays?: number) => {
    setState((current) => ({ ...current, challenge: createChallenge(habitId, lengthDays) }));
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

  const value = useMemo(
    () => ({
      ...state,
      loading,
      step,
      add,
      remove,
      startChallenge,
      dismissChallenge,
      updateSettings,
      resetToDemo,
    }),
    [state, loading, step, add, remove, startChallenge, dismissChallenge, updateSettings, resetToDemo],
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
