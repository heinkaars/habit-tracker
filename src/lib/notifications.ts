/**
 * Retention hook: daily local reminders. These are *local* scheduled
 * notifications, not remote push — which is why they still work in Expo Go
 * (remote push there needs a development build from SDK 53 on).
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { parseTime, type Habit } from '@/lib/habits';

/** Offered as quick picks when setting a habit's reminder. */
export const SUGGESTED_TIMES = ['07:00', '09:00', '12:00', '18:00', '20:00', '21:00'];
export const DEFAULT_REMINDER_TIME = '09:00';

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

/** Morning leads with intent; later in the day leads with the gap still open. */
function copyFor(habit: Habit, hour: number): { title: string; body: string } {
  const label = `${habit.emoji} ${habit.name}`;

  if (hour < 12) {
    return { title: label, body: 'Good time to get this one done.' };
  }

  return { title: label, body: "Still open — there's time before the day is out." };
}

/**
 * One daily notification per habit that has a reminder time. Replaces the whole
 * schedule rather than diffing it: the counts are small, and rebuilding is far
 * easier to reason about than reconciling.
 */
export async function rescheduleReminders(options: {
  enabled: boolean;
  habits: Habit[];
}): Promise<void> {
  if (!notificationsSupported()) return;

  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!options.enabled) return;

    const withReminders = options.habits.filter((habit) => parseTime(habit.reminderTime));
    if (withReminders.length === 0) return;

    const granted = await requestPermission();
    if (!granted) return;

    for (const habit of withReminders) {
      const time = parseTime(habit.reminderTime);
      if (!time) continue;

      await Notifications.scheduleNotificationAsync({
        content: copyFor(habit, time.hour),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: time.hour,
          minute: time.minute,
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
