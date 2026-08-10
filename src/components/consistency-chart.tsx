import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ChartDay = {
  key: string;
  /** Single-letter weekday, shown sparsely along the baseline. */
  label: string;
  /** 0–1 share of habits complete that day. */
  value: number;
  done: number;
  total: number;
};

const TRACK_HEIGHT = 96;
/** Zero days still get a stub so an empty day reads as empty, not missing. */
const EMPTY_STUB = 3;

/**
 * Single series, so magnitude rides on bar height and the hue stays constant —
 * no ramp, no legend. Tap a bar for its exact value (the touch analog of hover).
 */
export function ConsistencyChart({ days }: { days: ChartDay[] }) {
  const theme = useTheme();
  const [selected, setSelected] = useState<string | null>(null);

  const active = days.find((day) => day.key === selected) ?? null;

  return (
    <View style={styles.container}>
      <View style={styles.readout}>
        {active ? (
          <ThemedText type="smallBold">
            {active.done}/{active.total} on {active.label} · {Math.round(active.value * 100)}%
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Tap a bar for that day
          </ThemedText>
        )}
      </View>

      <View style={[styles.plot, { height: TRACK_HEIGHT }]}>
        {days.map((day, index) => {
          const isActive = day.key === active?.key;
          const isToday = index === days.length - 1;
          const height = Math.max(EMPTY_STUB, day.value * TRACK_HEIGHT);

          return (
            <Pressable
              key={day.key}
              onPress={() => setSelected(isActive ? null : day.key)}
              accessibilityRole="button"
              accessibilityLabel={`${day.label}, ${day.done} of ${day.total} complete`}
              style={styles.column}>
              <View style={styles.barSlot}>
                <View
                  style={[
                    styles.bar,
                    {
                      height,
                      backgroundColor:
                        day.value > 0 ? theme.accent : theme.backgroundSelected,
                      opacity: isActive || !active ? 1 : 0.45,
                    },
                    isToday && day.value === 0 && { backgroundColor: theme.textSecondary },
                  ]}
                />
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Recessive baseline — the axis should not compete with the data. */}
      <View style={[styles.axis, { backgroundColor: theme.backgroundSelected }]} />

      <View style={styles.labelRow}>
        {days.map((day, index) => (
          <View key={day.key} style={styles.column}>
            {/* Label every other day so the row never collides at 14 bars. */}
            {index % 2 === days.length % 2 ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
                {day.label}
              </ThemedText>
            ) : (
              <ThemedText type="small" style={styles.label}>
                {' '}
              </ThemedText>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  readout: {
    minHeight: 20,
  },
  plot: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  column: {
    flex: 1,
  },
  barSlot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  axis: {
    height: 1,
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    gap: 2,
  },
  label: {
    textAlign: 'center',
  },
});
