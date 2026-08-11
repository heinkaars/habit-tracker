/**
 * The Supabase client, or `null` when the project isn't configured yet.
 *
 * Nullable on purpose. The app is local-first: AsyncStorage is what the screens
 * render from, and Supabase is a sync target. With no credentials the whole
 * remote layer sits out and the app behaves exactly as it did before any of
 * this existed — which is also what keeps the web preview usable.
 *
 * Everything that touches the network must therefore null-check, and callers
 * should route through `requireSupabase()` when they genuinely need a client.
 */

// Must come before the client is created — supabase-js parses URLs at import
// time and React Native's built-in URL is incomplete.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/lib/database.types';

export type Client = SupabaseClient<Database>;

// EXPO_PUBLIC_ vars are inlined into the bundle at build time. That is fine for
// the anon key — it is designed to be published, and RLS is what actually
// protects the data. It is *not* fine for the service role key, which must
// never appear in this file or any other file under src/.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * True during the static web prerender, which runs in Node.
 *
 * `web.output` is "static", so every route is rendered once with no DOM.
 * AsyncStorage's web build reads `window.localStorage` directly, and
 * supabase-js touches storage while constructing the client to recover a
 * session — so handing it AsyncStorage here crashes the dev server on boot,
 * before a single route renders. React Native defines `window`, so this is
 * false on device.
 */
const prerendering = typeof window === 'undefined';

export const supabase: Client | null =
  url && anonKey
    ? createClient<Database>(url, anonKey, {
        auth: {
          // Undefined lets supabase-js fall back to its in-memory store, which
          // is the right lifetime for a render that ends with the response.
          storage: prerendering ? undefined : AsyncStorage,
          persistSession: !prerendering,
          autoRefreshToken: !prerendering,
          // There is no URL to read a session back from in a native app, and
          // leaving this on makes supabase-js poke at `window.location`.
          detectSessionInUrl: false,
        },
      })
    : null;

export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}

/** For call sites that have already established the client exists. */
export function requireSupabase(): Client {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and ' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY in .env and restart the dev server.',
    );
  }

  return supabase;
}

/**
 * Token refresh only runs while the app is foregrounded. Left running in the
 * background it retries on a dead network and burns the refresh token; the
 * session then looks valid locally but every request 401s.
 *
 * Web doesn't need this — the tab's own timers already stop when it sleeps.
 */
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (status) => {
    if (status === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
