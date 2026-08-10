import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useHabits } from '@/hooks/use-habits';
import { useTheme } from '@/hooks/use-theme';
import { feedbackComplete } from '@/lib/feedback';
import { notificationsSupported, scheduledCount } from '@/lib/notifications';

const HOUR_OPTIONS = [6, 7, 8, 9, 12, 18, 20, 21];

export default function SettingsScreen() {
  const theme = useTheme();
  const safeArea = useSafeAreaInsets();
  const { settings, updateSettings, resetToDemo } = useHabits();

  const [scheduled, setScheduled] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Re-read after any reminder change so the count reflects reality, not intent.
    scheduledCount().then((count) => {
      if (!cancelled) setScheduled(count);
    });

    return () => {
      cancelled = true;
    };
  }, [settings.remindersEnabled, settings.reminderHours]);

  function toggleHour(hour: number) {
    const hours = settings.reminderHours.includes(hour)
      ? settings.reminderHours.filter((value) => value !== hour)
      : [...settings.reminderHours, hour].sort((a, b) => a - b);

    updateSettings({ reminderHours: hours });
  }

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
          <ThemedText type="smallBold">Daily reminders</ThemedText>

          <View style={styles.row}>
            <ThemedText>Remind me</ThemedText>
            <Switch
              value={settings.remindersEnabled}
              disabled={!notificationsSupported()}
              onValueChange={(value) => updateSettings({ remindersEnabled: value })}
            />
          </View>

          {!notificationsSupported() ? (
            <ThemedText type="small" themeColor="textSecondary">
              Reminders need the iOS or Android app — not available on web.
            </ThemedText>
          ) : (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                When should we knock?
              </ThemedText>
              <View style={styles.chips}>
                {HOUR_OPTIONS.map((hour) => {
                  const on = settings.reminderHours.includes(hour);
                  return (
                    <Pressable
                      key={hour}
                      onPress={() => toggleHour(hour)}
                      disabled={!settings.remindersEnabled}
                      accessibilityRole="button"
                      accessibilityLabel={`Remind at ${String(hour).padStart(2, '0')}:00`}
                      accessibilityState={{ selected: on }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: on ? theme.accentSoft : theme.background,
                          borderColor: on ? theme.accent : 'transparent',
                          opacity: settings.remindersEnabled ? 1 : 0.4,
                        },
                      ]}>
                      <ThemedText type="small">
                        {String(hour).padStart(2, '0')}:00
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {settings.remindersEnabled
                  ? `${scheduled} ${scheduled === 1 ? 'reminder' : 'reminders'} scheduled. If none appear, notification permission was denied.`
                  : 'Off — nothing is scheduled.'}
              </ThemedText>
            </>
          )}
        </ThemedView>

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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  pressed: {
    opacity: 0.7,
  },
});
