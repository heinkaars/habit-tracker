import { Link, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Celebration, type CelebrationVariant } from '@/components/celebration';
import { CoachCard } from '@/components/coach-card';
import { HabitMenu } from '@/components/habit-menu';
import { HabitRow } from '@/components/habit-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useHabits } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { challengeTitle, daysRemaining } from '@/lib/challenges';
import { dayKey, isComplete, type Habit } from '@/lib/habits';

const CHEERS = ['Nice.', 'Logged.', 'Kept it going.', 'That’s the one.'];

export default function TodayScreen() {
  const theme = useTheme();
  const router = useRouter();
  const safeArea = useSafeAreaInsets();
  const { habits, challenge, loading, step, remove } = useHabits();

  const [celebration, setCelebration] = useState<CelebrationVariant | null>(null);
  const [message, setMessage] = useState('');
  const [menuHabit, setMenuHabit] = useState<Habit | null>(null);

  // Recomputed per render so the screen follows midnight rollovers.
  const today = dayKey();
  const doneToday = useMemo(
    () => habits.filter((habit) => isComplete(habit, today)).length,
    [habits, today],
  );

  const heading = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const challengeHabit = challenge ? habits.find((h) => h.id === challenge.habitId) : undefined;

  function onStep(habitId: string) {
    const outcome = step(habitId);

    if (outcome === 'challenge') {
      setMessage('Challenge complete! 🏆');
      setCelebration('challenge');
    } else if (outcome === 'complete') {
      setMessage(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
      setCelebration('complete');
    }
  }

  const clearCelebration = useCallback(() => setCelebration(null), []);

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: safeArea.top + Spacing.three,
            paddingBottom: safeArea.bottom + BottomTabInset + Spacing.four,
          },
        ]}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Today</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {heading}
          </ThemedText>
        </View>

        {!loading && habits.length > 0 && (
          <ThemedView type="backgroundElement" style={styles.summary}>
            <ThemedText type="smallBold">
              {doneToday} of {habits.length} done
            </ThemedText>
            <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
              <View
                style={[
                  styles.fill,
                  {
                    backgroundColor: theme.accent,
                    width: `${(doneToday / habits.length) * 100}%`,
                  },
                ]}
              />
            </View>
          </ThemedView>
        )}

        {challenge && challengeHabit && !challenge.completedAt && (
          <Link href="/challenge" asChild>
            <Pressable
              style={({ pressed }) => [styles.bannerPressable, pressed && styles.pressed]}>
              <ThemedView type="accentSoft" style={[styles.banner, { borderColor: theme.accent }]}>
                <ThemedText type="smallBold">
                  🏆 {challengeTitle(challenge)} · {challengeHabit.emoji} {challengeHabit.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {daysRemaining(challenge) === 1
                    ? 'Last day — tap for details'
                    : `${daysRemaining(challenge)} days left — tap for details`}
                </ThemedText>
              </ThemedView>
            </Pressable>
          </Link>
        )}

        {/* Below the challenge banner: the challenge is a commitment the user
            made, the note is advice about it. Renders nothing when absent. */}
        <CoachCard />

        {loading ? (
          <ThemedText type="small" themeColor="textSecondary">
            Loading…
          </ThemedText>
        ) : (
          habits.map((habit) => (
            <HabitRow
              key={habit.id}
              habit={habit}
              onPress={() => onStep(habit.id)}
              onMenu={() => setMenuHabit(habit)}
            />
          ))
        )}

        {!loading && habits.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            No habits yet — add your first one below.
          </ThemedText>
        )}

        <Link href="/new-habit" asChild>
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.addButton,
              { borderColor: theme.accent },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="smallBold" themeColor="accent">
              ＋ New habit
            </ThemedText>
          </Pressable>
        </Link>

        <ThemedText type="small" themeColor="textSecondary">
          Tap a habit to log it. Tap ⋯ to edit or delete.
        </ThemedText>
      </ScrollView>

      <Celebration variant={celebration} message={message} onDone={clearCelebration} />

      <HabitMenu
        habit={menuHabit}
        onClose={() => setMenuHabit(null)}
        onEdit={(id) => router.push(`/new-habit?id=${id}`)}
        onDelete={(id) => remove(id)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: {
    gap: Spacing.half,
  },
  summary: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
  bannerPressable: {
    alignSelf: 'stretch',
  },
  banner: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    gap: Spacing.half,
  },
  addButton: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
