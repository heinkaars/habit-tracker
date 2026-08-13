import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Habit } from '@/lib/habits';

type HabitMenuProps = {
  /** The habit the menu is open for, or `null` when closed. */
  habit: Habit | null;
  onClose: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
};

/**
 * Edit/delete for a habit, opened from the "⋯" on its row.
 *
 * Built on RN's `Modal` rather than `Alert.alert`. The menu has three options
 * (Edit / Delete / Cancel), and web has no native three-button alert to map
 * onto — React Native Web's `Alert.alert` only renders cleanly for the
 * two-button case, via `window.confirm`. That's why edit and delete worked on
 * device but looked entirely missing when tested on web: the alert was firing,
 * it just had nothing to render into.
 */
export function HabitMenu({ habit, onClose, onEdit, onDelete }: HabitMenuProps) {
  const [confirming, setConfirming] = useState(false);

  // A habit that's just been deleted stays in `menuHabit` for one more render
  // while the modal fades out — reset the stage on open, not on habit change,
  // or the fade-out flashes the confirm screen for whatever comes next.
  useEffect(() => {
    if (habit) setConfirming(false);
  }, [habit]);

  if (!habit) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* No accessibilityRole here: that renders an actual <button> on web,
          and it would end up wrapping the real buttons below it — invalid
          HTML (a button can't contain a button), which is the same issue the
          menu button on each habit row hit. This is a tap-to-dismiss scrim,
          not a control someone would tab to. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        {/* Stops a tap on the card from bubbling to the backdrop above and
            closing the menu out from under it — a real risk on web, where
            nested Pressables don't isolate a click the way native's responder
            system does. */}
        <Pressable onPress={(e) => e.stopPropagation()}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {habit.emoji} {habit.name}
            </ThemedText>

            {confirming ? (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  Remove &quot;{habit.name}&quot; and its history? This can&apos;t be undone.
                </ThemedText>
                <MenuRow label="Cancel" onPress={() => setConfirming(false)} />
                <MenuRow
                  label="Delete"
                  danger
                  onPress={() => {
                    onDelete(habit.id);
                    onClose();
                  }}
                />
              </>
            ) : (
              <>
                <MenuRow
                  label="Edit"
                  onPress={() => {
                    onEdit(habit.id);
                    onClose();
                  }}
                />
                <MenuRow label="Delete" danger onPress={() => setConfirming(true)} />
                <MenuRow label="Cancel" onPress={onClose} />
              </>
            )}
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuRow({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <ThemedText themeColor={danger ? 'danger' : 'text'}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    paddingVertical: Spacing.three,
  },
  pressed: {
    opacity: 0.7,
  },
});
