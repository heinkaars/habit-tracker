import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { SelectChip } from '@/components/select-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

type Mode = 'signIn' | 'signUp' | 'reset';

/**
 * Recovery is two steps: ask for the code, then redeem it. Kept as a stage
 * rather than a separate route because the screen budget is full, and because
 * the email address entered in step one is needed again in step two.
 */
type ResetStage = 'request' | 'confirm';

const RESET_CODE_LENGTH = 6;

/**
 * The seventh screen, and a deliberate spend of the 5–7 budget: signing in is a
 * flow with its own error and confirmation states, and folding that into
 * Settings would have made the longest screen in the app longer still.
 */
export default function SignInScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { configured, user, signIn, signUp, signOut, requestPasswordReset, resetPassword } =
    useAuth();

  const [mode, setMode] = useState<Mode>('signIn');
  const [resetStage, setResetStage] = useState<ResetStage>('request');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Switching modes must not carry an old error or notice into the new one. */
  const goTo = useCallback((next: Mode) => {
    setMode(next);
    setResetStage('request');
    setError(null);
    setNotice(null);
    setCode('');
    setPassword('');
  }, []);

  /**
   * Leaving this screen has to work even when nothing is underneath it.
   *
   * It's a modal, so the normal path (Settings → Account) pops back. But a deep
   * link, a web reload, or a notification tap can land here as the *first*
   * route — and then `back()` has nothing to pop to and strands the user on a
   * sign-in screen with no way into the app.
   */
  const dismiss = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }, [router]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // Mirrors `minimum_password_length` in supabase/config.toml. Checking it here
  // turns a round-trip and a raw API error message into an inline hint — so the
  // two have to move together, or a password the user is told is fine comes back
  // rejected. The character-class rule is left to the server: restating it here
  // would only duplicate a regex that Supabase already applies.
  const passwordValid = password.length >= 10;
  const codeValid = new RegExp(`^\\d{${RESET_CODE_LENGTH}}$`).test(code.trim());

  const canSubmit = (() => {
    if (!configured || busy) return false;
    if (mode === 'reset') {
      return resetStage === 'request' ? emailValid : codeValid && passwordValid;
    }
    return emailValid && passwordValid;
  })();

  async function submit() {
    if (!canSubmit) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    if (mode === 'reset') {
      const result =
        resetStage === 'request'
          ? await requestPasswordReset(email)
          : await resetPassword(email, code, password);

      setBusy(false);

      if (result.error) {
        setError(result.error);
        return;
      }

      if (resetStage === 'request') {
        // Deliberately says nothing about whether the address has an account —
        // a different message for "no such user" would turn this screen into a
        // way to find out who is registered.
        setNotice(
          `If ${email.trim()} has an account, a ${RESET_CODE_LENGTH}-digit code is on its way. Enter it below.`,
        );
        setResetStage('confirm');
        return;
      }

      // Redeeming the code signs the user in, so there's nothing left to do here.
      dismiss();
      return;
    }

    const result = mode === 'signUp' ? await signUp(email, password) : await signIn(email, password);

    setBusy(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    if (result.needsConfirmation) {
      setNotice(`Check ${email.trim()} for a confirmation link, then sign in.`);
      setMode('signIn');
      setPassword('');
      return;
    }

    dismiss();
  }

  if (!configured) {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">No project configured</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Copy .env.example to .env, fill in your Supabase URL and anon key, and restart
              the dev server. Until then the app saves everything on this device only —
              nothing is lost, it just doesn&apos;t sync.
            </ThemedText>
          </ThemedView>

          <DismissLink onPress={dismiss} />
        </ScrollView>
      </ThemedView>
    );
  }

  if (user) {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Signed in</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {user.email}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Your habits sync to this account. Signing out leaves the data on this device
              and stops syncing.
            </ThemedText>
          </ThemedView>

          <Pressable
            onPress={async () => {
              await signOut();
              dismiss();
            }}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: theme.disabledSurface },
              pressed && styles.pressed,
            ]}>
            <ThemedText style={styles.primaryLabel}>Sign out</ThemedText>
          </Pressable>

          <DismissLink onPress={dismiss} />
        </ScrollView>
      </ThemedView>
    );
  }

  if (mode === 'reset') {
    return (
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Reset your password</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {resetStage === 'request'
                ? `We'll email you a ${RESET_CODE_LENGTH}-digit code. Enter it here to choose a new password — there's no link to click, so this works the same on your phone as in a browser.`
                : 'Enter the code from the email, then pick a new password.'}
            </ThemedText>

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              accessibilityLabel="Email"
              // Locked once the code is out: changing it here would silently
              // verify against a different account than the one emailed.
              editable={resetStage === 'request'}
              style={[
                styles.input,
                {
                  color: resetStage === 'request' ? theme.text : theme.textSecondary,
                  backgroundColor: theme.backgroundSelected,
                },
              ]}
            />

            {resetStage === 'confirm' && (
              <>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  placeholder={'0'.repeat(RESET_CODE_LENGTH)}
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  maxLength={RESET_CODE_LENGTH}
                  accessibilityLabel="Reset code"
                  style={[
                    styles.input,
                    { color: theme.text, backgroundColor: theme.backgroundSelected },
                  ]}
                />

                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="New password"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  autoComplete="new-password"
                  secureTextEntry
                  accessibilityLabel="New password"
                  onSubmitEditing={submit}
                  style={[
                    styles.input,
                    { color: theme.text, backgroundColor: theme.backgroundSelected },
                  ]}
                />

                {password.length > 0 && !passwordValid && (
                  <ThemedText type="small" themeColor="accent">
                    Passwords need at least 10 characters, with upper and lower case letters and a digit.
                  </ThemedText>
                )}
              </>
            )}

            {error && (
              <ThemedText type="small" themeColor="accent">
                {error}
              </ThemedText>
            )}

            {notice && (
              <ThemedView type="accentSoft" style={[styles.notice, { borderColor: theme.accent }]}>
                <ThemedText type="small">{notice}</ThemedText>
              </ThemedView>
            )}
          </ThemedView>

          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: canSubmit ? theme.accent : theme.disabledSurface },
              pressed && styles.pressed,
            ]}>
            {busy ? (
              <ActivityIndicator color={canSubmit ? theme.onAccent : theme.textSecondary} />
            ) : (
              <ThemedText
                themeColor={canSubmit ? 'onAccent' : 'textSecondary'}
                style={styles.primaryLabel}>
                {resetStage === 'request' ? 'Send me a code' : 'Set new password'}
              </ThemedText>
            )}
          </Pressable>

          <DismissLink onPress={() => goTo('signIn')} label="Back to sign in" />
          <DismissLink onPress={dismiss} />
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.chips}>
            <SelectChip
              label="Sign in"
              selected={mode === 'signIn'}
              onPress={() => goTo('signIn')}
            />
            <SelectChip
              label="Create account"
              selected={mode === 'signUp'}
              onPress={() => goTo('signUp')}
            />
          </View>

          <ThemedText type="small" themeColor="textSecondary">
            {mode === 'signUp'
              ? 'Creating an account backs up your habits and lets you pick them up on another device.'
              : 'Sign in to pull your habits back down onto this device.'}
          </ThemedText>

          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            accessibilityLabel="Email"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
          />

          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
            secureTextEntry
            accessibilityLabel="Password"
            onSubmitEditing={submit}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundSelected }]}
          />

          {password.length > 0 && !passwordValid && (
            <ThemedText type="small" themeColor="accent">
              Passwords need at least 10 characters, with upper and lower case letters and a digit.
            </ThemedText>
          )}

          {mode === 'signIn' && (
            <Pressable
              onPress={() => goTo('reset')}
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="small" themeColor="accent">
                Forgot password?
              </ThemedText>
            </Pressable>
          )}

          {error && (
            <ThemedText type="small" themeColor="accent">
              {error}
            </ThemedText>
          )}

          {notice && (
            <ThemedView type="accentSoft" style={[styles.notice, { borderColor: theme.accent }]}>
              <ThemedText type="small">{notice}</ThemedText>
            </ThemedView>
          )}
        </ThemedView>

        <Pressable
          onPress={submit}
          disabled={!canSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSubmit }}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: canSubmit ? theme.accent : theme.disabledSurface },
            pressed && styles.pressed,
          ]}>
          {busy ? (
            <ActivityIndicator color={canSubmit ? theme.onAccent : theme.textSecondary} />
          ) : (
            <ThemedText
              themeColor={canSubmit ? 'onAccent' : 'textSecondary'}
              style={styles.primaryLabel}>
              {mode === 'signUp' ? 'Create account' : 'Sign in'}
            </ThemedText>
          )}
        </Pressable>

        <DismissLink onPress={dismiss} label="Skip for now — keep using the app" />

        <ThemedText type="small" themeColor="textSecondary" style={styles.footnote}>
          Habits you already have on this device stay put. Signing into an account that
          already has habits replaces them with that account&apos;s.
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

/**
 * Signing in is optional, so every state on this screen needs a visible exit.
 * Relying on the modal's own dismiss gesture wasn't enough — it doesn't exist
 * when this screen is the first route.
 */
function DismissLink({ onPress, label = 'Back to my habits' }: { onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}>
      <ThemedText type="small" themeColor="accent">
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.three,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  input: {
    height: 48,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  notice: {
    padding: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
  },
  primary: {
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryLabel: {
    fontWeight: '700',
  },
  footnote: {
    textAlign: 'center',
  },
  dismiss: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
});
