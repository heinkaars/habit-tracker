import type { Session, User } from '@supabase/supabase-js';
import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';

export type AuthResult = {
  /** Human-readable failure, or null on success. */
  error: string | null;
  /**
   * True when the account was created but Supabase is holding it until the
   * emailed link is clicked. Confirmations are on by default, and without this
   * a successful sign-up looks like a silent no-op to the user.
   */
  needsConfirmation?: boolean;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** True until the stored session has been read back. */
  loading: boolean;
  /** False when no Supabase credentials are configured. */
  configured: boolean;
  /**
   * True when the app should show nothing but the sign-in screen.
   *
   * An account is mandatory *when there is a project to hold one* — the app is
   * a sync client, and a signed-out user accumulates habits that live on one
   * device, never reach the AI features (see `ready()` in `lib/coach.ts`), and
   * are lost with the install. Gating on it is what makes the account the thing
   * that owns the data rather than an upsell buried in Settings.
   *
   * With no credentials configured this stays false and the whole remote layer
   * sits out, exactly as it did before the database existed — that is what
   * keeps the web preview and a fresh clone usable. Callers must still wait for
   * `loading`, or a returning user gets a flash of sign-in before their stored
   * session arrives.
   */
  requiresSignIn: boolean;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  /** Emails a six-digit recovery code. */
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  /** Exchanges that code for a session, then sets the new password. */
  resetPassword: (email: string, code: string, password: string) => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const NOT_CONFIGURED: AuthResult = {
  error: 'This app has no Supabase project configured yet.',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setSession(data.session);
      })
      .catch(() => {
        // A corrupt stored session shouldn't wedge the app on a spinner; the
        // user simply appears signed out and can sign in again.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) return { error: error.message };

    return { error: null, needsConfirmation: data.session === null };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    return { error: error ? error.message : null };
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  /**
   * Sends the recovery email.
   *
   * No `redirectTo`: the email carries a six-digit code rather than a link,
   * because a link needs a custom URL scheme that Expo Go can't receive. The
   * code path works the same on device, in Expo Go, and on web.
   *
   * Supabase deliberately succeeds whether or not the address has an account,
   * so this cannot be used to discover who is registered. Errors here are real
   * failures — usually the per-hour rate limit — and are worth showing.
   */
  const requestPasswordReset = useCallback(async (email: string): Promise<AuthResult> => {
    if (!supabase) return NOT_CONFIGURED;

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());

    return { error: error ? error.message : null };
  }, []);

  /**
   * Verifying the code returns a session, which is what authorises the password
   * change — `updateUser` acts on the signed-in user, so the two calls have to
   * happen in this order and the user ends up signed in on success.
   */
  const resetPassword = useCallback(
    async (email: string, code: string, password: string): Promise<AuthResult> => {
      if (!supabase) return NOT_CONFIGURED;

      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'recovery',
      });

      if (verifyError) return { error: verifyError.message };

      const { error } = await supabase.auth.updateUser({ password });

      return { error: error ? error.message : null };
    },
    [],
  );

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      configured: supabase !== null,
      requiresSignIn: supabase !== null && session === null,
      signUp,
      signIn,
      signOut,
      requestPasswordReset,
      resetPassword,
    }),
    [session, loading, signUp, signIn, signOut, requestPasswordReset, resetPassword],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }

  return context;
}
