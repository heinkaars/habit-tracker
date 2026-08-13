/**
 * Client for the AI Edge Functions.
 *
 * Everything here is best-effort and returns `null` rather than throwing: these
 * features sit on top of a local-first app that has to keep working with no
 * network, no account, and no Supabase project at all. A missing coaching note
 * is a card that doesn't render, never an error the user has to dismiss.
 *
 * Nothing in this file may be awaited from a check-in — a model call takes
 * seconds, and the core loop has to return in the same frame as the tap.
 */

import { supabase } from '@/lib/supabase';

export type CoachNote = {
  day: string;
  headline: string;
  body: string;
  focusHabitId: string | null;
  suggestion: string | null;
  dismissedAt: string | null;
};

export type Reflection = {
  period: 'week' | 'month';
  periodStart: string;
  periodEnd: string;
  headline: string;
  summary: string;
  wins: string[];
  watchOuts: string[];
  suggestion: string | null;
};

/** True only when there's a client and a signed-in session to authenticate with. */
async function ready(): Promise<boolean> {
  if (!supabase) return false;

  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

export async function fetchCoachNote(today: string): Promise<CoachNote | null> {
  if (!(await ready())) return null;

  const { data, error } = await supabase!.functions.invoke<{ note: CoachNote | null }>('coach', {
    body: { today },
  });

  if (error) return null;

  return data?.note ?? null;
}

export async function fetchReflection(
  period: 'week' | 'month',
  today: string,
): Promise<Reflection | null> {
  if (!(await ready())) return null;

  const { data, error } = await supabase!.functions.invoke<{ reflection: Reflection | null }>(
    'reflect',
    { body: { period, today } },
  );

  if (error) return null;

  return data?.reflection ?? null;
}

/**
 * Hides today's note. Written straight to the table rather than through a
 * function — there's no model call involved, and RLS already restricts the
 * update to the caller's own row.
 *
 * This is the *only* write the client makes to a cache table. Migration 0004
 * revokes DELETE outright and narrows UPDATE to the `dismissed_at` column, so
 * nothing else here could reach those tables even if it tried.
 */
export async function dismissCoachNote(day: string): Promise<void> {
  if (!(await ready())) return;

  await supabase!
    .from('coach_messages')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('day', day);
}

// There used to be `devClearCoachNote` / `devClearReflections` here, which
// deleted a cached row so the next fetch would regenerate. They were gated
// behind `__DEV__` in the Settings UI, but the functions themselves shipped in
// every bundle — and deleting a cache row is exactly how a user bypasses the
// one-call-per-day throttle and bills unlimited generations. Migration 0004
// revokes the DELETE privilege, which would make them fail silently anyway.
//
// To force a regeneration while developing, delete the row from the Supabase
// dashboard, or use a service-role script. That privilege belongs off-device.
