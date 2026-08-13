/** Shared request plumbing for the AI Edge Functions. */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function preflight(): Response {
  return new Response('ok', { headers: corsHeaders });
}

/**
 * Logs the real cause and returns a generic message to the caller.
 *
 * Postgres error text names constraints and columns, and the Anthropic SDK
 * echoes upstream API detail — neither is something a caller needs, and both
 * make probing these endpoints easier. The client discards the string anyway
 * (`lib/coach.ts` turns every failure into `null`), so there is no UX cost to
 * redacting it, and `console.error` keeps the detail in the function logs
 * where debugging actually happens.
 *
 * 422 is the one status with a caller-actionable meaning — the model declined
 * the data — so it gets its own wording rather than the generic fallback.
 */
export function safeError(cause: unknown, status: number, label: string): Response {
  console.error(`[${label}]`, cause);

  return json(
    {
      error:
        status === 422
          ? 'Could not generate a note for this data.'
          : 'Something went wrong. Please try again.',
    },
    status,
  );
}

/**
 * A Supabase client acting as the *calling user*, not as the service role.
 *
 * This is the security boundary. Forwarding the caller's JWT means every query
 * this function makes is filtered by the same RLS policies the app is subject
 * to — so even a bug that builds the wrong query cannot read another user's
 * habits. The service role key would bypass RLS entirely and must never be
 * used here.
 */
export function clientForRequest(req: Request): SupabaseClient | null {
  const authorization = req.headers.get('Authorization');
  if (!authorization) return null;

  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } } },
  );
}
