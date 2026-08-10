import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SelectChip } from '@/components/select-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useHabits } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import {
  DEFAULT_CHALLENGE_DAYS,
  MAX_CHALLENGE_DAYS,
  challengeDays,
  challengeProgress,
  challengeTitle,
  clampLength,
  daysRemaining,
  isExpired,
  isFulfilled,
} from '@/lib/challenges';
import { dayKey, isComplete, parseDayKey } from '@/lib/habits';

const LENGTH_OPTIONS = [DEFAULT_CHALLENGE_DAYS, 7, 14];

export default function ChallengeScreen() {
  const theme = useTheme();
  const safeArea = useSafeAreaInsets();
  const { habits, challenge, loading, startChallenge, dismissChallenge } = useHabits();

  const habit = challenge ? habits.find((item) => item.id === challenge.habitId) : undefined;
  const done = challenge && habit ? challengeProgress(challenge, habit) : 0;
  const fulfilled = challenge && habit ? isFulfilled(challenge, habit) : false;
  const expired = challenge && habit ? isExpired(challenge, habit) : false;

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
          <ThemedText type="subtitle">Challenge</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            A short commitment with a finish line
          </ThemedText>
        </View>

        {loading ? (
          <ThemedText type="small" themeColor="textSecondary">
            Loading…
          </ThemedText>
        ) : !challenge || !habit ? (
          <StartChallenge habits={habits} onStart={startChallenge} />
        ) : (
          <>
            <ThemedView
              type={fulfilled ? 'accentSoft' : 'backgroundElement'}
              style={[styles.card, fulfilled && { borderColor: theme.accent, borderWidth: 1 }]}>
              <ThemedText type="subtitle">{fulfilled ? '🏆' : '🎯'}</ThemedText>
              <ThemedText type="smallBold">
                {challengeTitle(challenge)} · {habit.emoji} {habit.name}
              </ThemedText>

              <ThemedText type="small" themeColor="textSecondary">
                {fulfilled
                  ? `Completed on ${challenge.completedAt}. You showed up ${challenge.lengthDays} days straight.`
                  : expired
                    ? `Ended with ${done} of ${challenge.lengthDays} days. Start another whenever you're ready.`
                    : `${done} of ${challenge.lengthDays} days done · ${daysRemaining(challenge)} left`}
              </ThemedText>

              <View style={styles.dayRow}>
                {challengeDays(challenge).map((key, index) => {
                  const complete = isComplete(habit, key);
                  const isPast = key < dayKey();
                  const missed = isPast && !complete;

                  return (
                    <View key={key} style={styles.day}>
                      <View
                        style={[
                          styles.box,
                          {
                            backgroundColor: complete ? theme.accent : theme.backgroundSelected,
                            borderColor: missed ? theme.textSecondary : theme.accent,
                            borderWidth: complete ? 0 : 1,
                          },
                        ]}>
                        <ThemedText
                          type="smallBold"
                          themeColor={complete ? 'onAccent' : 'textSecondary'}>
                          {complete ? '✓' : missed ? '·' : index + 1}
                        </ThemedText>
                      </View>
                      <ThemedText type="small" themeColor="textSecondary">
                        {parseDayKey(key).toLocaleDateString(undefined, { weekday: 'narrow' })}
                      </ThemedText>
                    </View>
                  );
                })}
              </View>
            </ThemedView>

            {(fulfilled || expired) && (
              <StartChallenge habits={habits} onStart={startChallenge} title="Start another" />
            )}

            <Pressable
              onPress={dismissChallenge}
              accessibilityRole="button"
              style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}>
              <ThemedText type="small" themeColor="textSecondary">
                {fulfilled || expired ? 'Clear this challenge' : 'Abandon challenge'}
              </ThemedText>
            </Pressable>
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function StartChallenge({
  habits,
  onStart,
  title = 'Start a challenge',
}: {
  habits: { id: string; name: string; emoji: string }[];
  onStart: (habitId: string, lengthDays?: number, name?: string) => void;
  title?: string;
}) {
  const theme = useTheme();
  const [selectedHabit, setSelectedHabit] = useState(habits[0]?.id ?? '');
  const [length, setLength] = useState(DEFAULT_CHALLENGE_DAYS);
  const [customDays, setCustomDays] = useState('');
  const [challengeName, setChallengeName] = useState('');

  // A typed value wins over the preset chips, so the two can't disagree.
  const typed = Number(customDays);
  const effectiveLength = customDays.trim() !== '' && Number.isFinite(typed)
    ? clampLength(typed)
    : length;
  const customValid = customDays.trim() === '' || (Number.isFinite(typed) && typed >= 1);

  if (habits.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        Add a habit first, then commit to a streak of it here.
      </ThemedText>
    );
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">{title}</ThemedText>

      <ThemedText type="small" themeColor="textSecondary">
        Which habit?
      </ThemedText>
      <View style={styles.chips}>
        {habits.map((habit) => (
          <SelectChip
            key={habit.id}
            label={`${habit.emoji} ${habit.name}`}
            selected={habit.id === selectedHabit}
            onPress={() => setSelectedHabit(habit.id)}
          />
        ))}
      </View>

      <ThemedText type="small" themeColor="textSecondary">
        Call it something (optional)
      </ThemedText>
      <TextInput
        value={challengeName}
        onChangeText={setChallengeName}
        placeholder="No-excuses week"
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
      />

      <ThemedText type="small" themeColor="textSecondary">
        How many days?
      </ThemedText>
      <View style={styles.chips}>
        {LENGTH_OPTIONS.map((option) => (
          <SelectChip
            key={option}
            label={`${option} days`}
            accessibilityLabel={`${option} day challenge`}
            selected={customDays.trim() === '' && option === length}
            onPress={() => {
              setLength(option);
              setCustomDays('');
            }}
          />
        ))}
      </View>
      <TextInput
        value={customDays}
        onChangeText={setCustomDays}
        placeholder={`Or set your own — up to ${MAX_CHALLENGE_DAYS}`}
        placeholderTextColor={theme.textSecondary}
        keyboardType="number-pad"
        accessibilityLabel="Custom challenge length in days"
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundSelected,
            borderColor: customValid ? 'transparent' : theme.accent,
          },
        ]}
      />

      <Pressable
        onPress={() => onStart(selectedHabit, effectiveLength, challengeName)}
        disabled={!customValid}
        accessibilityRole="button"
        accessibilityState={{ disabled: !customValid }}
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: customValid ? theme.accent : theme.disabledSurface },
          pressed && styles.pressed,
        ]}>
        <ThemedText
          themeColor={customValid ? 'onAccent' : 'textSecondary'}
          style={styles.primaryLabel}>
          Start {effectiveLength}-day challenge
        </ThemedText>
      </Pressable>
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
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  dayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  day: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  box: {
    width: 36,
    height: 36,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
  input: {
    height: 44,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  primary: {
    marginTop: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  primaryLabel: {
    fontWeight: '700',
  },
  textButton: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
});
