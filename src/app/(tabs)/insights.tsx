import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConsistencyChart, type ChartDay } from '@/components/consistency-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useHabits } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import {
  addDays,
  completionRate,
  dayKey,
  isComplete,
  longestStreak,
  progressOn,
  streak,
  totalCheckIns,
} from '@/lib/habits';

const CHART_DAYS = 14;
const WEEK_DAYS = 7;
const RATE_DAYS = 30;
const LOG_DAYS = 10;

export default function InsightsScreen() {
  const theme = useTheme();
  const safeArea = useSafeAreaInsets();
  const { habits, loading } = useHabits();

  const chartDays = useMemo<ChartDay[]>(() => {
    const today = new Date();

    return Array.from({ length: CHART_DAYS }, (_, i) => {
      const date = addDays(today, i - CHART_DAYS + 1);
      const key = dayKey(date);
      const done = habits.filter((habit) => isComplete(habit, key)).length;

      return {
        key,
        label: date.toLocaleDateString(undefined, { weekday: 'narrow' }),
        value: habits.length > 0 ? done / habits.length : 0,
        done,
        total: habits.length,
      };
    });
  }, [habits]);

  const weekDays = useMemo(() => {
    const today = new Date();
    return Array.from({ length: WEEK_DAYS }, (_, i) => {
      const date = addDays(today, i - WEEK_DAYS + 1);
      return {
        key: dayKey(date),
        label: date.toLocaleDateString(undefined, { weekday: 'narrow' }),
      };
    });
  }, []);

  const logDays = useMemo(() => {
    const today = new Date();

    return Array.from({ length: LOG_DAYS }, (_, i) => {
      const date = addDays(today, -i);
      const key = dayKey(date);
      const completed = habits.filter((habit) => isComplete(habit, key));
      const partial = habits.filter(
        (habit) => !isComplete(habit, key) && progressOn(habit, key) > 0,
      );

      return {
        key,
        label: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
        completed,
        partial,
      };
    });
  }, [habits]);

  const totals = useMemo(
    () => ({
      checkIns: habits.reduce((sum, habit) => sum + totalCheckIns(habit), 0),
      best: habits.reduce((best, habit) => Math.max(best, longestStreak(habit)), 0),
    }),
    [habits],
  );

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: safeArea.top + Spacing.three }]}>
          <ThemedText type="small" themeColor="textSecondary">
            Loading…
          </ThemedText>
        </ScrollView>
      </ThemedView>
    );
  }

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
          <ThemedText type="subtitle">Insights</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            How consistent you&apos;ve actually been
          </ThemedText>
        </View>

        {habits.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Add a habit on the Today tab to start building history.
          </ThemedText>
        ) : (
          <>
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Last {CHART_DAYS} days</ThemedText>
              <ConsistencyChart days={chartDays} />
            </ThemedView>

            <View style={styles.statRow}>
              <ThemedView type="backgroundElement" style={styles.stat}>
                <ThemedText type="subtitle">{totals.checkIns}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  total check-ins
                </ThemedText>
              </ThemedView>
              <ThemedView type="backgroundElement" style={styles.stat}>
                <ThemedText type="subtitle">{totals.best}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  longest streak ever
                </ThemedText>
              </ThemedView>
            </View>

            {habits.map((habit) => (
              <ThemedView key={habit.id} type="backgroundElement" style={styles.card}>
                <View style={styles.cardHeader}>
                  <ThemedText numberOfLines={1} style={styles.cardTitle}>
                    {habit.emoji} {habit.name}
                  </ThemedText>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {Math.round(completionRate(habit, RATE_DAYS) * 100)}%
                  </ThemedText>
                </View>

                <View style={styles.dayRow}>
                  {weekDays.map((day) => {
                    const done = isComplete(habit, day.key);
                    const partial = !done && progressOn(habit, day.key) > 0;

                    return (
                      <View key={day.key} style={styles.day}>
                        <View
                          style={[
                            styles.dot,
                            {
                              backgroundColor: done ? theme.accent : theme.backgroundSelected,
                              borderColor: theme.accent,
                              borderWidth: partial ? 2 : 0,
                            },
                          ]}
                        />
                        <ThemedText type="small" themeColor="textSecondary">
                          {day.label}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>

                <ThemedText type="small" themeColor="textSecondary">
                  {streak(habit) > 0 ? `🔥 ${streak(habit)} day streak` : 'No active streak'}
                  {habit.kind === 'count' ? ` · target ${habit.target}×/day` : ''}
                </ThemedText>
              </ThemedView>
            ))}

            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Log</ThemedText>
              {logDays.map((day) => (
                <View key={day.key} style={styles.logRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.logDate}>
                    {day.label}
                  </ThemedText>
                  <ThemedText type="small" style={styles.logValue}>
                    {day.completed.length === 0 && day.partial.length === 0
                      ? '—'
                      : `${day.completed.map((h) => h.emoji).join(' ')}${
                          day.partial.length > 0
                            ? `  (partial: ${day.partial.map((h) => h.emoji).join(' ')})`
                            : ''
                        }`}
                  </ThemedText>
                </View>
              ))}
            </ThemedView>
          </>
        )}
      </ScrollView>
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
  statRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  stat: {
    flex: 1,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.half,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.three,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  cardTitle: {
    flex: 1,
  },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  day: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  dot: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  logDate: {
    width: 96,
  },
  logValue: {
    flex: 1,
  },
});
