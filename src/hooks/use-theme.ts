/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  // useColorScheme can report null/undefined before the system value settles.
  return useColorScheme() === 'dark' ? Colors.dark : Colors.light;
}
