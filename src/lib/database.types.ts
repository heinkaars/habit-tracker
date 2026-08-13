/**
 * Row types for the tables in `supabase/migrations/0001_init.sql`.
 *
 * Hand-written rather than generated, because `supabase gen types` needs a
 * linked project and the CLI. Once the project exists you can replace this file
 * wholesale with:
 *
 *   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts
 *
 * `Insert` is deliberately the full row rather than "row minus defaults". The
 * sync engine always writes every column explicitly — under last-write-wins, a
 * partial upsert that lets the server fill in defaults is how you silently
 * reset someone's data.
 */

type Table<Row> = {
  Row: Row;
  Insert: Row;
  Update: Partial<Row>;
  Relationships: [];
};

/** Local day key, `YYYY-MM-DD`. Never a UTC instant. */
export type DayKey = string;

export type ProfileRow = {
  id: string;
  onboarded: boolean;
  sound: boolean;
  haptics: boolean;
  reminders_enabled: boolean;
  /** IANA name, e.g. "America/New_York". Null until a client has synced once. */
  timezone: string | null;
  updated_at: string;
};

export type HabitRow = {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  kind: 'binary' | 'count';
  target: number;
  created_at: DayKey;
  reminder_time: string | null;
  deleted_at: string | null;
  updated_at: string;
};

export type CheckInRow = {
  habit_id: string;
  user_id: string;
  day: DayKey;
  /** 0 means "logged nothing that day" — see the migration for why it's stored. */
  count: number;
  updated_at: string;
};

export type ChallengeRow = {
  id: string;
  user_id: string;
  habit_id: string;
  name: string;
  length_days: number;
  started_at: DayKey;
  completed_at: DayKey | null;
  deleted_at: string | null;
  updated_at: string;
};

/**
 * AI output caches (`0002_ai_coaching.sql`). The app only ever reads these and
 * updates `dismissed_at`; the rows themselves are written by the Edge
 * Functions, which is why `id` and `created_at` can carry database defaults
 * despite the `Insert`-equals-`Row` shape above.
 */
export type CoachMessageRow = {
  id: string;
  user_id: string;
  day: DayKey;
  headline: string;
  body: string;
  focus_habit_id: string | null;
  suggestion: string | null;
  dismissed_at: string | null;
  created_at: string;
};

export type ReflectionRow = {
  id: string;
  user_id: string;
  period: 'week' | 'month';
  period_start: DayKey;
  period_end: DayKey;
  headline: string;
  summary: string;
  wins: string[];
  watch_outs: string[];
  suggestion: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      habits: Table<HabitRow>;
      check_ins: Table<CheckInRow>;
      challenges: Table<ChallengeRow>;
      coach_messages: Table<CoachMessageRow>;
      reflections: Table<ReflectionRow>;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
