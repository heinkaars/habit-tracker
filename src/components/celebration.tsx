import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type CelebrationVariant = 'complete' | 'challenge';

const PARTICLES = 12;

type CelebrationProps = {
  variant: CelebrationVariant | null;
  message?: string;
  onDone: () => void;
};

function Particle({
  progress,
  angle,
  color,
  distance,
}: {
  progress: SharedValue<number>;
  angle: number;
  color: string;
  distance: number;
}) {
  const style = useAnimatedStyle(() => {
    const travelled = progress.value * distance;

    return {
      opacity: 1 - progress.value,
      transform: [
        { translateX: Math.cos(angle) * travelled },
        { translateY: Math.sin(angle) * travelled },
        { scale: 1 - progress.value * 0.6 },
      ],
    };
  });

  return <Animated.View style={[styles.particle, { backgroundColor: color }, style]} />;
}

/**
 * Non-interactive overlay burst. Rendering is skipped entirely when idle so it
 * costs nothing between check-ins.
 */
export function Celebration({ variant, message, onDone }: CelebrationProps) {
  const theme = useTheme();
  const progress = useSharedValue(0);
  const labelScale = useSharedValue(0.6);
  const labelOpacity = useSharedValue(0);

  const big = variant === 'challenge';

  useEffect(() => {
    if (!variant) return;

    const duration = big ? 1100 : 700;

    progress.value = 0;
    progress.value = withTiming(1, { duration, easing: Easing.out(Easing.quad) });

    labelOpacity.value = withSequence(
      withTiming(1, { duration: 160 }),
      withDelay(duration - 400, withTiming(0, { duration: 240 })),
    );
    labelScale.value = withSequence(
      withTiming(1.06, { duration: 200, easing: Easing.out(Easing.back(2)) }),
      withTiming(1, { duration: 140 }),
    );

    const timer = setTimeout(onDone, duration + 120);
    return () => clearTimeout(timer);
  }, [variant, big, progress, labelOpacity, labelScale, onDone]);

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelOpacity.value,
    transform: [{ scale: labelScale.value }],
  }));

  if (!variant) return null;

  const colors = [theme.accent, '#F5A623', '#34C759', '#FF5C8A'];

  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={styles.burst}>
        {Array.from({ length: big ? PARTICLES * 2 : PARTICLES }, (_, i) => (
          <Particle
            key={i}
            progress={progress}
            angle={(i / (big ? PARTICLES * 2 : PARTICLES)) * Math.PI * 2}
            color={colors[i % colors.length]}
            distance={big ? 190 : 120}
          />
        ))}
      </View>

      {message && (
        <Animated.View style={[styles.label, { backgroundColor: theme.accent }, labelStyle]}>
          <ThemedText style={styles.labelText}>{message}</ThemedText>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  burst: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  label: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.four,
  },
  labelText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
