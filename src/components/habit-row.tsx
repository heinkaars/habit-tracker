import { useEffect, useRef } from 'react';
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

/** Above this, pips get too wide for one line and the ratio carries it alone. */
const MAX_PIPS = 5;

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

  // Only the badge pops. Scaling the whole row pushed it past the screen edges
  // and clipped its rounded corners.
  const pop = useSharedValue(1);
  const wasDone = useRef(done);

  useEffect(() => {
    // Skip the mount pass, or every already-complete habit animates on load.
    if (done && !wasDone.current) {
      pop.value = withSequence(
        withTiming(1.25, { duration: 120 }),
        withSpring(1, { damping: 8, stiffness: 220 }),
      );
    }
    wasDone.current = done;
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
          ? `Logged ${progress} of ${habit.target} today. Tap to add one, long press to edit or delete`
          : 'Tap to toggle for today, long press to edit or delete'
      }
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}>
      <ThemedView
        type={done ? 'accentSoft' : 'backgroundElement'}
        style={[styles.row, done && { borderColor: theme.accent }]}>
        <Animated.View
          style={[
            styles.badge,
            { borderColor: done ? theme.accent : theme.textSecondary },
            done && { backgroundColor: theme.accent },
            popStyle,
          ]}>
          {done ? (
            <ThemedText themeColor="onAccent" style={styles.badgeDone}>
              ✓
            </ThemedText>
          ) : habit.kind === 'count' ? (
            <ThemedText type="smallBold" themeColor="textSecondary">
              {progress}
            </ThemedText>
          ) : null}
        </Animated.View>

        <View style={styles.labels}>
          {/* Progress sits on the title line so count habits are the same
              height as binary ones. */}
          <View style={styles.titleRow}>
            <ThemedText numberOfLines={1} style={styles.title}>
              {habit.emoji} {habit.name}
            </ThemedText>

            {habit.kind === 'count' && (
              <View style={styles.progressInline}>
                {habit.target <= MAX_PIPS &&
                  Array.from({ length: habit.target }, (_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.pip,
                        {
                          backgroundColor:
                            i < progress ? theme.accent : theme.backgroundSelected,
                        },
                      ]}
                    />
                  ))}
                <ThemedText type="smallBold" themeColor={done ? 'accent' : 'textSecondary'}>
                  {progress}/{habit.target}
                </ThemedText>
              </View>
            )}
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            {streakCount > 0 ? `🔥 ${streakCount} day streak` : 'No streak yet'}
          </ThemedText>
        </View>
      </ThemedView>
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
    fontWeight: '700',
    lineHeight: 20,
  },
  labels: {
    flex: 1,
    gap: Spacing.one,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
  },
  progressInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  pip: {
    width: 14,
    height: 6,
    borderRadius: 3,
  },
});
