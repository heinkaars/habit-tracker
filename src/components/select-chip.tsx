import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SelectChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
};

/**
 * The single selection control for the whole app.
 *
 * Selected is a solid `accent` fill, not a tinted outline: on a dark card the
 * tinted version was nearly the same value as the surface and read as an
 * unstyled checkbox. Unselected sits on `backgroundSelected` so it still reads
 * as a filled control rather than a hole punched in the card.
 */
export function SelectChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  style,
}: SelectChipProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.accent : theme.backgroundSelected,
          borderColor: selected ? theme.accent : 'transparent',
        },
        style,
        pressed && styles.pressed,
      ]}>
      <ThemedText type="small" themeColor={selected ? 'onAccent' : 'text'}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
