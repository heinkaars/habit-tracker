/**
 * The reward half of the core loop. Every check-in fires haptics + sound here;
 * the matching visual lives in <Celebration>.
 *
 * Players are created lazily and kept alive for the session — building one per
 * tap adds latency that makes the reward feel disconnected from the press.
 */

import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type FeedbackPrefs = { sound: boolean; haptics: boolean };

let prefs: FeedbackPrefs = { sound: true, haptics: true };
let chime: AudioPlayer | null = null;
let fanfare: AudioPlayer | null = null;

export function setFeedbackPrefs(next: FeedbackPrefs) {
  prefs = next;
}

function play(which: 'chime' | 'fanfare') {
  if (!prefs.sound) return;

  try {
    if (which === 'chime') {
      chime ??= createAudioPlayer(require('@/assets/sounds/chime.wav'));
      chime.seekTo(0);
      chime.play();
    } else {
      fanfare ??= createAudioPlayer(require('@/assets/sounds/fanfare.wav'));
      fanfare.seekTo(0);
      fanfare.play();
    }
  } catch {
    // Audio is a garnish — never let it break a check-in.
  }
}

function haptic(run: () => Promise<void>) {
  // expo-haptics is a no-op-or-throw on web depending on browser.
  if (!prefs.haptics || Platform.OS === 'web') return;
  run().catch(() => {});
}

/** Progress on a count habit that didn't finish it — a nudge, not a payoff. */
export function feedbackStep() {
  haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A habit just hit its target for the day. */
export function feedbackComplete() {
  haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  play('chime');
}

/** Undoing a completion should feel neutral, not punishing. */
export function feedbackUndo() {
  haptic(() => Haptics.selectionAsync());
}

/** The big one: a challenge was fulfilled. */
export function feedbackChallenge() {
  haptic(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    }, 140);
  });
  play('fanfare');
}
