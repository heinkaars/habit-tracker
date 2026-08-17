import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';

import { AuthProvider, useAuth } from '@/hooks/use-auth';
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
          <RootStack />
        </HabitsProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

/**
 * Split out of `RootLayout` only so it can read `useAuth()` — the provider that
 * owns the session is mounted above it.
 */
function RootStack() {
  const { requiresSignIn } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      <Stack.Screen
        name="new-habit"
        options={{ presentation: 'modal', headerShown: true, title: 'New habit' }}
      />
      {/* One screen, two jobs. Reached from Settings while signed in it manages
          the account, so it stays a modal you can back out of. Standing in front
          of a signed-out app it is the only route there is — as a modal it would
          still offer a swipe-down and a header back button, both of which land
          on a tab layout that immediately redirects here again. */}
      <Stack.Screen
        name="sign-in"
        options={
          requiresSignIn
            ? { presentation: 'card', headerShown: false, gestureEnabled: false }
            : { presentation: 'modal', headerShown: true, title: 'Account' }
        }
      />
    </Stack>
  );
}
