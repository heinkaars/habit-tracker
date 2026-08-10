import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { HabitsProvider } from '@/hooks/use-habits';
import { configureNotificationHandler } from '@/lib/notifications';

// Must be registered before any notification can arrive.
configureNotificationHandler();

export default function RootLayout() {
  const isDark = useColorScheme() === 'dark';

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      <HabitsProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
          <Stack.Screen
            name="new-habit"
            options={{ presentation: 'modal', headerShown: true, title: 'New habit' }}
          />
        </Stack>
      </HabitsProvider>
    </ThemeProvider>
  );
}
