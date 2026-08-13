/**
 * Required environment, read at module load rather than at first use.
 *
 * The lazy alternative fails at the moment of the first model call, which in
 * this project is invisible: `lib/coach.ts` turns every failure into `null`, so
 * a deploy that forgot a secret renders as a card that quietly doesn't appear.
 * This codebase has already lost weeks to a server-side failure nobody could
 * see from the app (see the pg_net and typo'd-hostname notes in
 * `0006_pg_net.sql`) — a throw at boot puts it in the deploy log instead.
 *
 * Deliberately not used for `CRON_SECRET`. That one stays a per-request check
 * returning 401, because a boot-time throw would answer an unauthenticated
 * probe with a 500 and tell it the deployment is misconfigured.
 */
export function requireEnv(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Set it with: supabase secrets set ${name}=...`,
    );
  }

  return value;
}

/**
 * The first of several names that is set, for values the platform injects under
 * more than one name.
 *
 * Same reasoning as `serviceKey()` in `coach-cadence`: Supabase is midway
 * through replacing its legacy JWT keys with `sb_publishable_...` /
 * `sb_secret_...`, and which variable a project's functions receive depends on
 * where that project sits in the migration. Failing at boot is the right
 * behaviour for a genuinely absent secret; it is the wrong behaviour for one
 * that is simply present under the newer name, and a boot failure takes the
 * whole function down rather than one request.
 *
 * Order the names newest-first. A name that doesn't exist on this project just
 * falls through, so listing one costs nothing.
 */
export function requireEnvOneOf(names: readonly string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }

  throw new Error(`Missing required environment variable, tried: ${names.join(', ')}`);
}
