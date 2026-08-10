/**
 * Retention hook: daily local reminders. These are *local* scheduled
 * notifications, not remote push — which is why they still work in Expo Go
 * (remote push there needs a development build from SDK 53 on).
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Habit } from '@/lib/habits';

/** Slots default to a morning start-your-day nudge and an evening last-call. */
export const DEFAULT_REMINDER_HOURS = [9, 20];

export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export function notificationsSupported(): boolean {
  return Platform.OS !== 'web';
}

export async function requestPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;

  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.granted) return true;

    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch {
    return false;
  }
}

/** Morning leads with intent, evening leads with the gap that's still open. */
function copyFor(hour: number, habits: Habit[]): { title: string; body: string } {
  const names = habits.map((habit) => `${habit.emoji} ${habit.name}`);
  const sample = names.length > 0 ? names[Math.floor(Math.random() * names.length)] : 'your habits';

  if (hour < 12) {
    return {
      title: 'Ready to start?',
      body: names.length > 0 ? `${sample} is waiting for you today.` : 'Set up a habit to track today.',
    };
  }

  return {
    title: "Don't lose the streak",
    body:
      names.length > 0
        ? `Still time to check off ${sample} before the day is out.`
        : 'Check in before the day is out.',
  };
}

/**
 * Replaces the whole schedule rather than diffing it — there are only a couple
 * of notifications and rebuilding is far easier to reason about than reconciling.
 */
export async function rescheduleReminders(options: {
  enabled: boolean;
  hours: number[];
  habits: Habit[];
}): Promise<void> {
  if (!notificationsSupported()) return;

  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!options.enabled) return;

    const granted = await requestPermission();
    if (!granted) return;

    for (const hour of options.hours) {
      await Notifications.scheduleNotificationAsync({
        content: copyFor(hour, options.habits),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute: 0,
        },
      });
    }
  } catch {
    // A device that refuses to schedule shouldn't take the app down with it.
  }
}

export async function scheduledCount(): Promise<number> {
  if (!notificationsSupported()) return 0;

  try {
    return (await Notifications.getAllScheduledNotificationsAsync()).length;
  } catch {
    return 0;
  }
}
