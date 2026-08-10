import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useHabits } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_CHALLENGE_DAYS } from '@/lib/challenges';

/** Concrete, low-friction starters — picking from a list beats a blank field. */
const STARTERS = [
  { name: 'Morning walk', emoji: '🏃', kind: 'binary' as const, target: 1 },
  { name: 'Read 10 pages', emoji: '📖', kind: 'binary' as const, target: 1 },
  { name: 'Drink water', emoji: '💧', kind: 'count' as const, target: 4 },
  { name: 'Meditate', emoji: '🧘', kind: 'binary' as const, target: 1 },
  { name: 'No phone after 10pm', emoji: '🌙', kind: 'binary' as const, target: 1 },
  { name: 'Stretch', emoji: '🎸', kind: 'count' as const, target: 2 },
];

export default function OnboardingScreen() {
  const theme = useTheme();
  const safeArea = useSafeAreaInsets();
  const router = useRouter();
  const { add, startChallenge, updateSettings } = useHabits();

  const [picked, setPicked] = useState<number | null>(null);

  function begin() {
    if (picked === null) return;

    const starter = STARTERS[picked];
    const habit = add(starter.name, starter.emoji, starter.kind, starter.target);

    // The challenge starts immediately — a finish line before motivation fades.
    startChallenge(habit.id, DEFAULT_CHALLENGE_DAYS);
    updateSettings({ onboarded: true });
    router.replace('/');
  }

  function skip() {
    updateSettings({ onboarded: true });
    router.replace('/');
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: safeArea.top + Spacing.five,
            paddingBottom: safeArea.bottom + Spacing.five,
          },
        ]}>
        <View style={styles.header}>
          <ThemedText type="title">Pick one habit</ThemedText>
          <ThemedText themeColor="textSecondary">
            Start with a single habit and a {DEFAULT_CHALLENGE_DAYS}-day challenge. You can add more
            later.
          </ThemedText>
        </View>

        <View style={styles.list}>
          {STARTERS.map((starter, index) => {
            const selected = picked === index;

            return (
              <Pressable
                key={starter.name}
                onPress={() => setPicked(index)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.option, pressed && styles.pressed]}>
                <ThemedView
                  type={selected ? 'accentSoft' : 'backgroundElement'}
                  style={[styles.optionInner, selected && { borderColor: theme.accent }]}>
                  <ThemedText>
                    {starter.emoji} {starter.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {starter.kind === 'count' ? `${starter.target}× a day` : 'Once a day'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={begin}
          disabled={picked === null}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: theme.accent },
            picked === null && styles.disabled,
            pressed && styles.pressed,
          ]}>
          <ThemedText style={styles.primaryLabel}>
            Start my {DEFAULT_CHALLENGE_DAYS}-day challenge
          </ThemedText>
        </Pressable>

        <Pressable onPress={skip} accessibilityRole="button" style={styles.textButton}>
          <ThemedText type="small" themeColor="textSecondary">
            Skip for now
          </ThemedText>
        </Pressable>
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
    gap: Spacing.four,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: {
    gap: Spacing.two,
  },
  list: {
    gap: Spacing.two,
  },
  option: {
    alignSelf: 'stretch',
  },
  optionInner: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: Spacing.half,
  },
  primary: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  primaryLabel: {
    color: '#ffffff',
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.4,
  },
  textButton: {
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
