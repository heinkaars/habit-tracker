import { Redirect, Tabs } from 'expo-router';
import { Image, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useHabits } from '@/hooks/use-habits';

const ICONS = {
  home: require('@/assets/images/tabIcons/home.png'),
  explore: require('@/assets/images/tabIcons/explore.png'),
};

export default function TabsLayout() {
  const isDark = useColorScheme() === 'dark';
  const colors = isDark ? Colors.dark : Colors.light;
  const { settings, loading } = useHabits();
  const { requiresSignIn, loading: authLoading } = useAuth();

  // Hold the tabs back until storage and the stored session settle, otherwise a
  // returning user gets a flash of sign-in or onboarding before their saved
  // state arrives.
  if (loading || authLoading) return null;

  // Sign-in gates onboarding, not the other way round. The account is what
  // decides which habits this device has: first contact adopts the account's
  // habits wholesale when it has any, so onboarding first would have the user
  // pick a starter and begin a challenge only for the first sync to throw both
  // away. In this order a returning user on a new device also picks `onboarded`
  // up from their profile and never sees onboarding a second time.
  if (requiresSignIn) return <Redirect href="/sign-in" />;
  if (!settings.onboarded) return <Redirect href="/onboarding" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.backgroundElement,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => (
            <Image source={ICONS.home} style={[styles.icon, { tintColor: color }]} />
          ),
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Insights',
          tabBarIcon: ({ color }) => (
            <Image source={ICONS.explore} style={[styles.icon, { tintColor: color }]} />
          ),
        }}
      />
      <Tabs.Screen
        name="challenge"
        options={{
          title: 'Challenge',
          tabBarIcon: ({ color }) => (
            <Image source={ICONS.home} style={[styles.icon, { tintColor: color }]} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => (
            <Image source={ICONS.explore} style={[styles.icon, { tintColor: color }]} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 24,
    height: 24,
  },
});
