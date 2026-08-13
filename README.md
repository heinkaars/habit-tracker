# Habit Tracker

A habit tracker built on Expo + React Native, running on iOS, Android, and web
from one codebase.

Habits, a fixed-length challenge, and daily reminders — kept local-first, with
optional Supabase sync and Claude-powered coaching notes when it's configured.

## Get started

```bash
npm install
npm run web        # dev server + web preview
npm run ios        # dev server, opens iOS target
npm run android    # dev server, opens Android target
```

This project is pinned to **Expo SDK 54** deliberately — see [CLAUDE.md](./CLAUDE.md)
before upgrading anything Expo-related.

### Optional: Supabase sync and AI coaching

The app works fully offline with no configuration. To enable account sync and
the AI coaching/reflection features, copy `.env.example` to `.env` and fill in
your Supabase project details. See `supabase/migrations/0001_init.sql` for the
schema and `supabase/functions/` for the Edge Functions.

## Commands

```bash
npm run lint         # eslint via expo lint
npm run test:parity  # cross-checks src/lib/habits.ts against the Edge Function copy
npx tsc --noEmit      # typecheck (not part of lint, run separately)
npx expo-doctor       # dependency/config health check
```

There is no test framework configured — verification is typecheck + lint +
running the app.

## Architecture

Data flows in one direction: pure logic → context → screens.

- **`src/lib/`** — pure functions, no React and no storage (`habits.ts`,
  `challenges.ts`, `feedback.ts`, `notifications.ts`).
- **`src/hooks/use-habits.tsx`** — the only stateful layer; persists to
  AsyncStorage and owns the migration chain between storage versions.
- **`src/app/`** — expo-router screens, kept stateless with respect to habits.

See [CLAUDE.md](./CLAUDE.md) for the full architecture notes, domain rules,
and the product framework (core loop, challenge, retention) this app is
structured around.

## License

Private project, not currently licensed for reuse.
