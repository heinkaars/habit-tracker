import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useReflection } from '@/hooks/use-coach';
import { parseDayKey } from '@/lib/habits';

function formatRange(start: string, end: string): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };

  return `${parseDayKey(start).toLocaleDateString(undefined, options)} – ${parseDayKey(
    end,
  ).toLocaleDateString(undefined, options)}`;
}

/**
 * Last completed week's reflection, on Insights.
 *
 * Like the coach card, absent rather than empty when there's nothing to show —
 * a signed-out user sees the same Insights screen they saw before this existed.
 */
export function ReflectionCard() {
  const { reflection } = useReflection('week');

  if (!reflection) return null;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="smallBold">✦ {reflection.headline}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatRange(reflection.periodStart, reflection.periodEnd)}
        </ThemedText>
      </View>

      <ThemedText type="small">{reflection.summary}</ThemedText>

      {reflection.wins.length > 0 && (
        <View style={styles.list}>
          {reflection.wins.map((win) => (
            <ThemedText key={win} type="small">
              ✓ {win}
            </ThemedText>
          ))}
        </View>
      )}

      {reflection.watchOuts.length > 0 && (
        <View style={styles.list}>
          {reflection.watchOuts.map((item) => (
            <ThemedText key={item} type="small" themeColor="textSecondary">
              → {item}
            </ThemedText>
          ))}
        </View>
      )}

      {reflection.suggestion && (
        <ThemedText type="small" themeColor="accent">
          {reflection.suggestion}
        </ThemedText>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  header: {
    gap: Spacing.half,
  },
  list: {
    gap: Spacing.one,
  },
});
