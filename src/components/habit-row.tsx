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
  onMenu: () => void;
};

export function HabitRow({ habit, onPress, onMenu }: HabitRowProps) {
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
    // Plain View, not a Pressable: on web, accessibilityRole="button" renders
    // an actual <button>, and a <button> can't legally contain another
    // <button> — nesting one caused a hydration warning and put the two taps
    // in the same DOM subtree, which is what made the menu button's tap leak
    // through to this row's onPress in the first place. The main area and the
    // menu button are now independent, sibling buttons instead.
    <ThemedView
      type={done ? 'accentSoft' : 'backgroundElement'}
      style={[styles.row, done && { borderColor: theme.accent }]}>
      <Pressable
        onPress={onPress}
        // Long press still works as a shortcut on native, but it's no longer
        // the only way in — the "⋯" button is what actually works on web (a
        // mouse has no long-press) and doesn't require discovering a hidden
        // gesture on any platform.
        onLongPress={onMenu}
        accessibilityRole="button"
        accessibilityState={{ checked: done }}
        accessibilityLabel={habit.name}
        accessibilityHint={
          habit.kind === 'count'
            ? `Logged ${progress} of ${habit.target} today. Tap to add one.`
            : 'Tap to toggle for today.'
        }
        style={({ pressed }) => [styles.mainArea, pressed && styles.pressed]}>
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
      </Pressable>

      <Pressable
        onPress={onMenu}
        accessibilityRole="button"
        accessibilityLabel={`More options for ${habit.name}`}
        hitSlop={10}
        style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}>
        <ThemedText themeColor="textSecondary" style={styles.menuDots}>
          ⋯
        </ThemedText>
      </Pressable>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  row: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  mainArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
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
  menuButton: {
    padding: Spacing.two,
  },
  menuDots: {
    fontSize: 20,
    lineHeight: 20,
    fontWeight: '700',
  },
});
