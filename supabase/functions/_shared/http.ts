/** Shared request plumbing for the AI Edge Functions. */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { requireEnv, requireEnvOneOf } from './env.ts';

// Read at load, so a function missing its platform variables fails in the
// deploy log rather than on the first request. See `env.ts`.
const SUPABASE_URL = requireEnv('SUPABASE_URL');

// Publishable first, legacy anon second — a project that has moved to the new
// key system may not receive `SUPABASE_ANON_KEY` at all, and a boot-time throw
// on a project that is simply newer would take both AI functions offline.
// Either key is the same privilege level: publishable, RLS-governed.
const SUPABASE_ANON_KEY = requireEnvOneOf([
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_ANON_KEY',
]);

/**
 * Origins allowed to call these functions from a browser.
 *
 * Only the web build needs CORS at all — native clients send no `Origin` and
 * are unaffected by any of this. A wildcard was not a session risk here (auth
 * is a bearer token read from storage, and `Access-Control-Allow-Credentials`
 * is deliberately never set, so a hostile page cannot ride a victim's session)
 * but it did mean a leaked token was usable from any page on the internet, with
 * no origin in the logs to tell your own app apart from a script.
 *
 * `EXTRA_CORS_ORIGINS` is a comma-separated escape hatch for preview
 * deployments, so adding one is a `supabase secrets set` rather than a redeploy
 * of this file.
 */
const ALLOWED_ORIGINS = new Set(
  [
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    ...(Deno.env.get('EXTRA_CORS_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ],
);

/**
 * CORS headers for one request.
 *
 * An unknown origin gets the literal string `null`, which no browser treats as
 * a match — the request still executes, it just isn't readable cross-origin.
 * `Vary: Origin` keeps a CDN from caching one origin's answer for another.
 */
export function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');

  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/**
 * Per-request responder, so every response carries that request's CORS headers.
 *
 * A factory rather than threading `req` through four exported functions: the
 * standalone versions are gone, so there is no longer a way to emit a response
 * that silently forgot its origin handling.
 */
export function respond(req: Request) {
  const headers = corsFor(req);

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });

  return {
    json,

    preflight: (): Response => new Response('ok', { headers }),

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
    error: (cause: unknown, status: number, label: string): Response => {
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
    },
  };
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

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authorization } },
  });
}
