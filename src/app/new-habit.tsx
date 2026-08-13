import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { SelectChip } from '@/components/select-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useHabits } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { EMOJI_CHOICES, formatTime, parseTime, type Habit, type HabitKind } from '@/lib/habits';
import { SUGGESTED_TIMES, notificationsSupported } from '@/lib/notifications';

const TARGET_OPTIONS = [2, 3, 4, 6, 8];

/** Doubles as the edit screen when given `?id=` — keeps the surface count at 6. */
export default function HabitFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { habits, loading } = useHabits();

  // The form seeds its fields from `useState` initialisers, which only run once.
  // Waiting for storage (and keying by id) is what makes an edit arrive filled in.
  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="small" themeColor="textSecondary">
            Loading…
          </ThemedText>
        </ScrollView>
      </ThemedView>
    );
  }

  const existing = id ? habits.find((habit) => habit.id === id) : undefined;

  return <HabitForm key={existing?.id ?? 'new'} existing={existing} />;
}

function HabitForm({ existing }: { existing?: Habit }) {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { add, update } = useHabits();

  const editing = Boolean(existing);

  const [name, setName] = useState(existing?.name ?? '');
  const [emoji, setEmoji] = useState<string>(existing?.emoji ?? EMOJI_CHOICES[0]);
  const [kind, setKind] = useState<HabitKind>(existing?.kind ?? 'binary');
  const [target, setTarget] = useState(existing?.target && existing.target > 1 ? existing.target : 4);
  const [reminder, setReminder] = useState<string>(existing?.reminderTime ?? '');

  useEffect(() => {
    navigation.setOptions({ title: editing ? 'Edit habit' : 'New habit' });
  }, [navigation, editing]);

  const trimmedName = name.trim();
  const valid = trimmedName.length > 0;
  const parsedReminder = parseTime(reminder);
  const reminderValid = reminder.trim() === '' || Boolean(parsedReminder);
  const canSubmit = valid && reminderValid;

  function submit() {
    if (!canSubmit) return;

    const reminderTime = parsedReminder ? reminder.trim() : null;
    const draft = { name, emoji, kind, target, reminderTime };

    if (existing) {
      update(existing.id, draft);
    } else {
      add(draft);
    }

    // The user asked to be told, explicitly, that a reminder is actually set.
    if (reminderTime) {
      Alert.alert(
        'Reminder set',
        `${emoji} ${trimmedName} will remind you every day at ${formatTime(reminderTime)}.${
          notificationsSupported() ? '' : '\n\nReminders only fire on iOS or Android.'
        }`,
        [{ text: 'Done', onPress: () => router.back() }],
      );
      return;
    }

    router.back();
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">What do you want to track?</ThemedText>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Morning run"
            placeholderTextColor={theme.textSecondary}
            returnKeyType="done"
            onSubmitEditing={submit}
            autoFocus={!editing}
            // Matches the `habits_name_length` constraint. The constraint is the
            // control — PostgREST, not this screen, is the real entry point, and
            // a habit name is copied verbatim into a billed model call. This is
            // only here so the UI agrees with it instead of surfacing a raw
            // Postgres error on save.
            maxLength={80}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
          />
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
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
                    backgroundColor: choice === emoji ? theme.accent : theme.backgroundSelected,
                    borderColor: choice === emoji ? theme.accent : 'transparent',
                  },
                ]}>
                <ThemedText>{choice}</ThemedText>
              </Pressable>
            ))}
          </View>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
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
              <ThemedText type="small" themeColor="textSecondary">
                How many times a day?
              </ThemedText>
              <View style={styles.chips}>
                {TARGET_OPTIONS.map((option) => (
                  <SelectChip
                    key={option}
                    label={`${option}×`}
                    accessibilityLabel={`${option} times a day`}
                    selected={option === target}
                    onPress={() => setTarget(option)}
                  />
                ))}
              </View>
            </>
          )}
        </ThemedView>

        {/* One card holds the label, the picks, the free-text field and the
            resulting state, so the section reads as a single control. */}
        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Remind me at</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Each habit has its own time. Leave blank for no reminder.
          </ThemedText>

          <View style={styles.chips}>
            {SUGGESTED_TIMES.map((option) => (
              <SelectChip
                key={option}
                label={option}
                accessibilityLabel={`Remind at ${option}`}
                selected={reminder === option}
                onPress={() => setReminder(reminder === option ? '' : option)}
              />
            ))}
          </View>

          <TextInput
            value={reminder}
            onChangeText={setReminder}
            placeholder="Or type a time — 06:45"
            placeholderTextColor={theme.textSecondary}
            keyboardType="numbers-and-punctuation"
            accessibilityLabel="Reminder time"
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.backgroundSelected,
                borderColor: reminderValid ? 'transparent' : theme.accent,
              },
            ]}
          />

          <ThemedView
            type={parsedReminder ? 'accentSoft' : 'background'}
            style={[styles.confirm, { borderColor: parsedReminder ? theme.accent : 'transparent' }]}>
            <ThemedText
              type="small"
              themeColor={!reminderValid ? 'accent' : parsedReminder ? 'text' : 'textSecondary'}>
              {!reminderValid
                ? 'Use 24-hour HH:MM, e.g. 06:45.'
                : parsedReminder
                  ? `✓ Reminds every day at ${formatTime(reminder)}`
                  : 'No reminder for this habit.'}
            </ThemedText>
          </ThemedView>
        </ThemedView>

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
          style={({ pressed }) => [
            styles.primary,
            // Swap the surface rather than fading the whole button — dropping
            // opacity fades label and background together into invisibility.
            { backgroundColor: canSubmit ? theme.accent : theme.disabledSurface },
            pressed && styles.pressed,
          ]}>
          <ThemedText
            themeColor={canSubmit ? 'onAccent' : 'textSecondary'}
            style={styles.primaryLabel}>
            {editing ? 'Save changes' : 'Add habit'}
          </ThemedText>
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
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[
        styles.kindChip,
        {
          backgroundColor: selected ? theme.accentSoft : theme.backgroundSelected,
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
    gap: Spacing.three,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  input: {
    height: 48,
    borderRadius: Spacing.two,
    borderWidth: 1,
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
  confirm: {
    padding: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  primary: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  primaryLabel: {
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
});
