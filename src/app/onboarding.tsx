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
  { name: 'Morning walk', emoji: '🏃', kind: 'binary' as const, target: 1, reminderTime: '07:00' },
  { name: 'Read 10 pages', emoji: '📖', kind: 'binary' as const, target: 1, reminderTime: '21:00' },
  { name: 'Drink water', emoji: '💧', kind: 'count' as const, target: 4, reminderTime: '12:00' },
  { name: 'Meditate', emoji: '🧘', kind: 'binary' as const, target: 1, reminderTime: '08:00' },
  { name: 'No phone after 10pm', emoji: '🌙', kind: 'binary' as const, target: 1, reminderTime: null },
  { name: 'Stretch', emoji: '🎸', kind: 'count' as const, target: 2, reminderTime: '18:00' },
];

const HOW_IT_WORKS = [
  { icon: '➕', title: 'Create a habit', body: 'Once a day, or several times a day with a target.' },
  { icon: '👆', title: 'Tap to track it', body: 'Every check-in gives you a buzz, a chime, and a streak.' },
  { icon: '🏆', title: 'Take a challenge', body: 'Commit for a few days and get a payoff at the finish line.' },
  { icon: '📈', title: 'Watch it add up', body: 'Insights shows your streaks and how consistent you really are.' },
  { icon: '🔔', title: 'Get a nudge', body: 'Each habit can remind you at its own time of day.' },
];

export default function OnboardingScreen() {
  const theme = useTheme();
  const safeArea = useSafeAreaInsets();
  const router = useRouter();
  const { add, startChallenge, updateSettings } = useHabits();

  const [step, setStep] = useState<'explain' | 'pick'>('explain');
  const [picked, setPicked] = useState<number | null>(null);

  function begin() {
    if (picked === null) return;

    const starter = STARTERS[picked];
    const habit = add({
      name: starter.name,
      emoji: starter.emoji,
      kind: starter.kind,
      target: starter.target,
      reminderTime: starter.reminderTime,
    });

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
        {step === 'explain' ? (
          <>
            <View style={styles.header}>
              <ThemedText type="title">How it works</ThemedText>
              <ThemedText themeColor="textSecondary">
                Five things, and that&apos;s the whole app.
              </ThemedText>
            </View>

            <View style={styles.list}>
              {HOW_IT_WORKS.map((item) => (
                <ThemedView key={item.title} type="backgroundElement" style={styles.explainRow}>
                  <ThemedText style={styles.explainIcon}>{item.icon}</ThemedText>
                  <View style={styles.explainCopy}>
                    <ThemedText type="smallBold">{item.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {item.body}
                    </ThemedText>
                  </View>
                </ThemedView>
              ))}
            </View>

            <Pressable
              onPress={() => setStep('pick')}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: theme.accent },
                pressed && styles.pressed,
              ]}>
              <ThemedText themeColor="onAccent" style={styles.primaryLabel}>
                Got it
              </ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.header}>
              <ThemedText type="title">Pick one habit</ThemedText>
              <ThemedText themeColor="textSecondary">
                Start with a single habit and a {DEFAULT_CHALLENGE_DAYS}-day challenge. You can add
                more later.
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
                    accessibilityLabel={`${starter.emoji} ${starter.name}`}
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
                        {starter.reminderTime ? ` · reminds at ${starter.reminderTime}` : ''}
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
              accessibilityState={{ disabled: picked === null }}
              style={({ pressed }) => [
                styles.primary,
                { backgroundColor: picked === null ? theme.disabledSurface : theme.accent },
                pressed && styles.pressed,
              ]}>
              <ThemedText
                themeColor={picked === null ? 'textSecondary' : 'onAccent'}
                style={styles.primaryLabel}>
                Start my {DEFAULT_CHALLENGE_DAYS}-day challenge
              </ThemedText>
            </Pressable>
          </>
        )}

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
  explainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  explainIcon: {
    fontSize: 22,
  },
  explainCopy: {
    flex: 1,
    gap: Spacing.half,
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
    fontWeight: '700',
  },
  textButton: {
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
