import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useCoachNote } from '@/hooks/use-coach';
import { useTheme } from '@/hooks/use-theme';

/**
 * The coaching nudge on Today.
 *
 * Renders nothing at all when there's no note — signed out, offline, no
 * Supabase project, or nothing worth saying today. It never shows a spinner or
 * an empty state: this sits above the habit list, and a placeholder there would
 * push the actual habits down for no reason.
 */
export function CoachCard() {
  const theme = useTheme();
  const { note, dismiss } = useCoachNote();

  if (!note) return null;

  return (
    <ThemedView type="accentSoft" style={[styles.card, { borderColor: theme.accent }]}>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold" style={styles.headline}>
          ✦ {note.headline}
        </ThemedText>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss coaching note"
          hitSlop={12}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="small" themeColor="textSecondary">
            ✕
          </ThemedText>
        </Pressable>
      </View>

      <ThemedText type="small">{note.body}</ThemedText>

      {note.suggestion && (
        <ThemedText type="small" themeColor="textSecondary">
          {note.suggestion}
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  headline: {
    // Without this the dismiss control gets pushed off-screen by a long headline.
    flex: 1,
  },
  pressed: {
    opacity: 0.7,
  },
});
