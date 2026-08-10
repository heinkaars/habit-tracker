import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dayKey, isComplete, progressOn, streak, type Habit } from '@/lib/habits';

type HabitRowProps = {
  habit: Habit;
  onPress: () => void;
  onLongPress: () => void;
};

export function HabitRow({ habit, onPress, onLongPress }: HabitRowProps) {
  const theme = useTheme();
  const today = dayKey();
  const done = isComplete(habit, today);
  const progress = progressOn(habit, today);
  const streakCount = streak(habit);

  // Pops once when the habit crosses into complete, so the reward is tied to
  // the state change rather than to every tap.
  const pop = useSharedValue(1);
  useEffect(() => {
    if (done) {
      pop.value = withSequence(
        withTiming(1.12, { duration: 120 }),
        withSpring(1, { damping: 8, stiffness: 220 }),
      );
    }
  }, [done, pop]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ checked: done }}
      accessibilityLabel={habit.name}
      accessibilityHint={
        habit.kind === 'count'
          ? `Logged ${progress} of ${habit.target} today. Tap to add one, long press to delete`
          : 'Tap to toggle for today, long press to delete'
      }
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      <Animated.View style={popStyle}>
        <ThemedView
          type={done ? 'accentSoft' : 'backgroundElement'}
          style={[styles.row, done && { borderColor: theme.accent }]}>
          <View
            style={[
              styles.badge,
              { borderColor: done ? theme.accent : theme.textSecondary },
              done && { backgroundColor: theme.accent },
            ]}>
            {done ? (
              <ThemedText style={styles.badgeDone}>✓</ThemedText>
            ) : habit.kind === 'count' ? (
              <ThemedText type="smallBold" themeColor="textSecondary">
                {progress}
              </ThemedText>
            ) : null}
          </View>

          <View style={styles.labels}>
            <ThemedText numberOfLines={1}>
              {habit.emoji} {habit.name}
            </ThemedText>

            {habit.kind === 'count' && (
              <View style={styles.pips}>
                {Array.from({ length: habit.target }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.pip,
                      {
                        backgroundColor: i < progress ? theme.accent : theme.backgroundSelected,
                      },
                    ]}
                  />
                ))}
                <ThemedText type="small" themeColor="textSecondary" style={styles.pipLabel}>
                  {progress}/{habit.target}
                </ThemedText>
              </View>
            )}

            <ThemedText type="small" themeColor="textSecondary">
              {streakCount > 0 ? `🔥 ${streakCount} day streak` : 'No streak yet'}
            </ThemedText>
          </View>
        </ThemedView>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignSelf: 'stretch',
  },
  pressed: {
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDone: {
    color: '#ffffff',
    fontWeight: '700',
    lineHeight: 20,
  },
  labels: {
    flex: 1,
    gap: Spacing.one,
  },
  pips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  pip: {
    width: 18,
    height: 6,
    borderRadius: 3,
  },
  pipLabel: {
    marginLeft: Spacing.one,
  },
});
