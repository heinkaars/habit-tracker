import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Celebration, type CelebrationVariant } from '@/components/celebration';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useHabits, type SyncStatus } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { challengeTitle } from '@/lib/challenges';
import { feedbackChallenge, feedbackComplete } from '@/lib/feedback';
import { formatTime } from '@/lib/habits';
import { notificationsSupported, scheduledCount } from '@/lib/notifications';

const SYNC_LABEL: Record<SyncStatus, string> = {
  off: 'Saved on this device only.',
  idle: 'Everything is backed up.',
  syncing: 'Syncing…',
  pending: 'Changes saved here, waiting to upload.',
  error: 'Offline — changes are saved here and will upload later.',
};

export default function SettingsScreen() {
  const router = useRouter();
  const safeArea = useSafeAreaInsets();
  const { user } = useAuth();
  const {
    habits,
    challenge,
    settings,
    syncStatus,
    updateSettings,
    resetToDemo,
    devShiftChallenge,
    devFillChallenge,
  } = useHabits();

  const [scheduled, setScheduled] = useState(0);
  const [celebration, setCelebration] = useState<CelebrationVariant | null>(null);

  const withReminders = habits.filter((habit) => habit.reminderTime);

  useEffect(() => {
    let cancelled = false;
    // Re-read after any reminder change so the count reflects reality, not intent.
    scheduledCount().then((count) => {
      if (!cancelled) setScheduled(count);
    });

    return () => {
      cancelled = true;
    };
  }, [settings.remindersEnabled, habits]);

  const clearCelebration = useCallback(() => setCelebration(null), []);

  function confirmReset() {
    Alert.alert('Reset to demo data', 'This replaces your habits and history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: resetToDemo },
    ]);
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
          <ThemedText type="subtitle">Settings</ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Account</ThemedText>

          <Pressable
            onPress={() => router.push('/sign-in')}
            accessibilityRole="button"
            accessibilityLabel={user ? `Signed in as ${user.email}` : 'Sign in'}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
            <ThemedText numberOfLines={1} style={styles.reminderName}>
              {user ? user.email : 'Not signed in'}
            </ThemedText>
            <ThemedText type="smallBold" themeColor="accent">
              {user ? 'Manage' : 'Sign in'}
            </ThemedText>
          </Pressable>

          <ThemedText type="small" themeColor="textSecondary">
            {SYNC_LABEL[syncStatus]}
          </ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Reward feedback</ThemedText>

          <View style={styles.row}>
            <ThemedText>Sound</ThemedText>
            <Switch
              value={settings.sound}
              onValueChange={(value) => {
                updateSettings({ sound: value });
                if (value) feedbackComplete();
              }}
            />
          </View>

          <View style={styles.row}>
            <ThemedText>Haptics</ThemedText>
            <Switch
              value={settings.haptics}
              onValueChange={(value) => updateSettings({ haptics: value })}
            />
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            {Platform.OS === 'web'
              ? 'Haptics are unavailable in a browser.'
              : 'The chime respects your device’s silent switch.'}
          </ThemedText>
        </ThemedView>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Reminders</ThemedText>

          <View style={styles.row}>
            <ThemedText>Remind me</ThemedText>
            <Switch
              value={settings.remindersEnabled}
              disabled={!notificationsSupported()}
              onValueChange={(value) => updateSettings({ remindersEnabled: value })}
            />
          </View>

          {!notificationsSupported() && (
            <ThemedText type="small" themeColor="textSecondary">
              Reminders only fire on iOS or Android — the times below are saved but
              won&apos;t notify in a browser.
            </ThemedText>
          )}

          <>
              <ThemedText type="small" themeColor="textSecondary">
                Each habit has its own time. Tap one to change it.
              </ThemedText>

              {habits.map((habit) => (
                <Pressable
                  key={habit.id}
                  onPress={() => router.push(`/new-habit?id=${habit.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Reminder for ${habit.name}, ${formatTime(habit.reminderTime)}`}
                  style={({ pressed }) => [styles.reminderRow, pressed && styles.pressed]}>
                  <ThemedText numberOfLines={1} style={styles.reminderName}>
                    {habit.emoji} {habit.name}
                  </ThemedText>
                  <ThemedText
                    type="smallBold"
                    themeColor={habit.reminderTime ? 'accent' : 'textSecondary'}>
                    {formatTime(habit.reminderTime)}
                  </ThemedText>
                </Pressable>
              ))}

              <ThemedText type="small" themeColor="textSecondary">
                {!settings.remindersEnabled
                  ? 'Off — nothing is scheduled.'
                  : !notificationsSupported()
                    ? `${withReminders.length} with a time set.`
                    : `${withReminders.length} with a time set · ${scheduled} scheduled on this device.${
                        withReminders.length > 0 && scheduled === 0
                          ? ' If this stays at 0, notification permission was denied.'
                          : ''
                      }`}
              </ThemedText>
          </>
        </ThemedView>

        {__DEV__ && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Developer</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Debug builds only. Lets you reach the reward without waiting days.
            </ThemedText>

            {challenge ? (
              <>
                <ThemedText type="small">
                  {challengeTitle(challenge)} · starts {challenge.startedAt}
                  {challenge.completedAt ? ` · completed ${challenge.completedAt}` : ''}
                </ThemedText>

                <View style={styles.devRow}>
                  <View style={styles.devRowItem}>
                    <DevButton label="◀ Start −1 day" onPress={() => devShiftChallenge(-1)} />
                  </View>
                  <View style={styles.devRowItem}>
                    <DevButton label="Start +1 day ▶" onPress={() => devShiftChallenge(1)} />
                  </View>
                </View>

                <DevButton
                  label="Fill all but the last day"
                  hint="Leaves the real completion one genuine tap away on Today"
                  onPress={() => devFillChallenge(true)}
                />
                <DevButton
                  label="Complete the whole challenge"
                  onPress={() => devFillChallenge(false)}
                />
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                No active challenge — start one on the Challenge tab.
              </ThemedText>
            )}

            <DevButton
              label="Preview check-in reward"
              onPress={() => {
                feedbackComplete();
                setCelebration('complete');
              }}
            />
            <DevButton
              label="Preview challenge reward"
              onPress={() => {
                feedbackChallenge();
                setCelebration('challenge');
              }}
            />
          </ThemedView>
        )}

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="smallBold">Data</ThemedText>
          <Pressable
            onPress={confirmReset}
            accessibilityRole="button"
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedText themeColor="accent">Reset to demo data</ThemedText>
          </Pressable>
        </ThemedView>
      </ScrollView>

      <Celebration
        variant={celebration}
        message={celebration === 'challenge' ? 'Challenge complete! 🏆' : 'Nice.'}
        onDone={clearCelebration}
      />
    </ThemedView>
  );
}

function DevButton({
  label,
  hint,
  onPress,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.devButton,
        { borderColor: theme.accent },
        pressed && styles.pressed,
      ]}>
      <ThemedText type="small" themeColor="accent">
        {label}
      </ThemedText>
      {hint && (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      )}
    </Pressable>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  reminderName: {
    flex: 1,
  },
  devRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  devRowItem: {
    flex: 1,
  },
  devButton: {
    // No flex here — a stretching button collapsed its own height and let the
    // hint text spill past the border into the next row.
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: Spacing.half,
  },
  pressed: {
    opacity: 0.7,
  },
});
