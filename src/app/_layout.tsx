import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';

import { AuthProvider } from '@/hooks/use-auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { HabitsProvider } from '@/hooks/use-habits';
import { configureNotificationHandler } from '@/lib/notifications';

// Must be registered before any notification can arrive.
configureNotificationHandler();

export default function RootLayout() {
  const isDark = useColorScheme() === 'dark';

  return (
    <ThemeProvider value={isDark ? DarkTheme : DefaultTheme}>
      {/* Auth wraps habits: the habit store reads the session to decide what to
          sync, so it has to sit inside the provider that owns it. */}
      <AuthProvider>
        <HabitsProvider>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
            <Stack.Screen
              name="new-habit"
              options={{ presentation: 'modal', headerShown: true, title: 'New habit' }}
            />
            <Stack.Screen
              name="sign-in"
              options={{ presentation: 'modal', headerShown: true, title: 'Account' }}
            />
          </Stack>
        </HabitsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
