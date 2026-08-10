import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useHabits } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { EMOJI_CHOICES, type HabitKind } from '@/lib/habits';

const TARGET_OPTIONS = [2, 3, 4, 6, 8];

export default function NewHabitScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { add } = useHabits();

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState<string>(EMOJI_CHOICES[0]);
  const [kind, setKind] = useState<HabitKind>('binary');
  const [target, setTarget] = useState(4);

  const valid = name.trim().length > 0;

  function submit() {
    if (!valid) return;

    add(name, emoji, kind, target);
    router.back();
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="smallBold">What do you want to track?</ThemedText>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Meditate for 10 minutes"
          placeholderTextColor={theme.textSecondary}
          returnKeyType="done"
          onSubmitEditing={submit}
          autoFocus
          style={[
            styles.input,
            { color: theme.text, backgroundColor: theme.backgroundElement },
          ]}
        />

        <ThemedText type="smallBold">Icon</ThemedText>
        <View style={styles.chips}>
          {EMOJI_CHOICES.map((choice) => (
            <Pressable
              key={choice}
              onPress={() => setEmoji(choice)}
              accessibilityRole="button"
              accessibilityLabel={`Icon ${choice}`}
              accessibilityState={{ selected: choice === emoji }}
              style={[
                styles.emojiChip,
                {
                  backgroundColor: choice === emoji ? theme.accentSoft : theme.backgroundElement,
                  borderColor: choice === emoji ? theme.accent : 'transparent',
                },
              ]}>
              <ThemedText>{choice}</ThemedText>
            </Pressable>
          ))}
        </View>

        <ThemedText type="smallBold">How does it work?</ThemedText>
        <View style={styles.chips}>
          <KindChip
            label="Once a day"
            hint="Done or not done"
            selected={kind === 'binary'}
            onPress={() => setKind('binary')}
          />
          <KindChip
            label="Several times a day"
            hint="Counts toward a target"
            selected={kind === 'count'}
            onPress={() => setKind('count')}
          />
        </View>

        {kind === 'count' && (
          <>
            <ThemedText type="smallBold">How many times a day?</ThemedText>
            <View style={styles.chips}>
              {TARGET_OPTIONS.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setTarget(option)}
                  accessibilityRole="button"
                  accessibilityLabel={`${option} times a day`}
                  accessibilityState={{ selected: option === target }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        option === target ? theme.accentSoft : theme.backgroundElement,
                      borderColor: option === target ? theme.accent : 'transparent',
                    },
                  ]}>
                  <ThemedText type="small">{option}×</ThemedText>
                </Pressable>
              ))}
            </View>
          </>
        )}

        <Pressable
          onPress={submit}
          disabled={!valid}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: theme.accent },
            !valid && styles.disabled,
            pressed && styles.pressed,
          ]}>
          <ThemedText style={styles.primaryLabel}>Add habit</ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

function KindChip({
  label,
  hint,
  selected,
  onPress,
}: {
  label: string;
  hint: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.kindChip,
        {
          backgroundColor: selected ? theme.accentSoft : theme.backgroundElement,
          borderColor: selected ? theme.accent : 'transparent',
        },
      ]}>
      <ThemedText type="small">{label}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {hint}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.two,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  input: {
    height: 48,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
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
  emojiChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindChip: {
    flex: 1,
    minWidth: 140,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    gap: Spacing.half,
  },
  primary: {
    marginTop: Spacing.three,
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
  pressed: {
    opacity: 0.7,
  },
});
