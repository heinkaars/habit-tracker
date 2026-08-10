# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

A habit tracker built on Expo + React Native, running on iOS, Android, and web from one codebase.

It is deliberately structured around a product framework — keep changes inside it rather than bolting features on:

| Layer | Where it lives |
|---|---|
| **Core function** — create and track habits | `lib/habits.ts`, Today screen |
| **Core loop** — every check-in rewards | `lib/feedback.ts` (haptics + sound), `components/celebration.tsx` (visual) |
| **Challenge** — fixed-length commitment with a payoff | `lib/challenges.ts`, Challenge screen |
| **Accessory** — logging and consistency | Insights screen, `components/consistency-chart.tsx` |
| **Retention** — daily nudges | `lib/notifications.ts`, Settings screen |

**Surface-area budget: 5–7 screens, and it currently sits at 6** (4 tabs + onboarding + the new-habit modal). Adding a seventh needs a deliberate decision; an eighth means merging something first. This is a product constraint, not an accident.

Two things deliberately avoid spending that budget: `new-habit.tsx` doubles as the **edit** screen via `?id=`, and the developer tools live in a `__DEV__`-gated section of Settings rather than their own screen.

## Expo SDK 54 is pinned deliberately — do not upgrade

The project was moved down from SDK 57 to **SDK 54** because the target iPhone's Expo Go supports SDK 54 and cannot be updated further (iOS version cap). Running `npx expo install --fix` against a newer `expo` package, or bumping `expo` in `package.json`, will silently break the only way this app gets onto the device.

Consult the **v54** docs (`https://docs.expo.dev/versions/v54.0.0/`), not the latest. SDK 57 APIs that are absent in 54 and were already removed once here:

- `ThemeProvider` / `DarkTheme` / `DefaultTheme` come from `@react-navigation/native`, not from `expo-router`.
- Navigation uses the standard `Tabs` navigator from `expo-router`. The `expo-router/unstable-native-tabs` API differs between 54 and 57 — avoid it.
- `useColorScheme()` returns `'light' | 'dark' | null | undefined`. There is no `'unspecified'` value (that is RN 0.86 / SDK 57).
- `eslint-config-expo` is v10 here; rules from newer configs (e.g. `react-hooks/set-state-in-effect`) do not exist and an `eslint-disable` naming one is itself a lint error.

## Commands

```bash
npm run web        # dev server + web preview (also serves the native manifest on :8081)
npm run ios        # dev server, opens iOS target
npm run android    # dev server, opens Android target
npm run lint       # eslint via expo lint
npx tsc --noEmit   # typecheck — not part of lint, run it separately
npx expo-doctor    # dependency/config health check
```

There is **no test framework configured** — no `test` script, no Jest. Verification is typecheck + lint + running the app.

`.claude/launch.json` defines the `expo-web` server for `preview_start`. Only one entry exists because Expo serves every platform from a single Metro instance on port 8081; `ios`/`android` are native targets, not browser-previewable.

### Running on a physical device

Expo Go connects over `exp://<mac-lan-ip>:8081`. The LAN IP changes on DHCP renewal, and a stale IP shows up as "Unknown error: The request timed out" in Expo Go. Get the current one with `ipconfig getifaddr en0`, or use `npx expo start --tunnel` for an address that survives IP changes.

## Architecture

Data flows in one direction: pure logic → context → screens.

- **`src/lib/`** — pure functions, no React and no storage. `habits.ts` (day keys, streaks, rates, seed), `challenges.ts` (fixed-length commitments). `feedback.ts` and `notifications.ts` are side-effecting but stateless. Change behavior here, not in screens.
- **`src/hooks/use-habits.tsx`** — the only stateful layer. Holds `{ habits, challenge, settings }`, persists to AsyncStorage under `habit-tracker.state.v2`, and owns the migration from the v1 key. Its `loading` flag guards the first write so an empty state can't overwrite stored data before the read settles.
- **`src/app/`** — expo-router. Root `_layout.tsx` is a Stack (tab group + onboarding + modal); `(tabs)/_layout.tsx` holds the tab bar and gates on onboarding.

Screens are stateless with respect to habits — they read `useHabits()` and call lib helpers. Nothing computes streaks or dates inline.

### Domain rules worth knowing

- Day keys are local-time `YYYY-MM-DD`, never UTC — "today" means the user's today. `addDays` rebuilds dates from parts so DST cannot shift a day.
- An incomplete *today* does not break a streak: `streak()` falls back to counting from yesterday, since the day isn't over. Changing this changes what every streak in the app means.
- **Two habit kinds share one log shape.** `log` is `dayKey -> count`; `binary` habits are just `target: 1`. Nothing downstream branches on kind — never add a parallel code path for one kind.
- `logStep()` wraps a count habit back to zero once it passes its target, so a mis-tap is always a few taps from correct rather than stuck.
- **The challenge resolves exactly once**, on the tap that fulfils its final day — that transition is what fires the big celebration. Don't move fulfilment detection into render.

### Storage migrations

`use-habits.tsx` reads `habit-tracker.state.v2`, falling back to the v1 key and running `migrateV1()`. Users have real history on device, so reseeding silently destroys it. Two cases:

- **Additive fields** (a new nullable property) are filled in by `normalize()` on read. Nothing already stored is reinterpreted, so the key stays.
- **Anything that reinterprets existing data** needs a new key plus another forward-read, like v1 → v2 did.

### Feedback and notifications

- `feedback.ts` keeps audio players alive for the session; creating one per tap adds latency that visibly decouples the reward from the press. Sound respects the device silent switch by design.
- Reminders are **local scheduled** notifications, which is why they work in Expo Go. Remote push would need a development build. `rescheduleReminders()` rebuilds the whole schedule rather than diffing it.
- **Reminder times live on the habit** (`habit.reminderTime`, local `HH:MM` or null), not in settings. Settings holds only the master on/off. One notification is scheduled per habit that has a time.
- Both degrade on web: haptics no-op and notifications never fire. Settings still shows and saves the times there, with a note, so the config is testable in the browser preview.

### Colour rules that are not cosmetic

**Never hardcode `#ffffff` for text on `accent`.** Dark mode's accent is a *light* blue, where white measures 2.69:1 and reads as invisible — this shipped once and had to be fixed everywhere. Use `themeColor="onAccent"`, which is white in light mode and near-black in dark.

**Never disable a button with blanket `opacity`.** Fading the surface and its label together is what made "Add habit" vanish. Swap the surface to `disabledSurface` and the label to `textSecondary` instead.

**Never put `background` on top of `backgroundElement`.** Inside a card, `background` is pure black in dark mode and reads as a hole punched in the surface — chips styled that way looked like unstyled checkboxes. Controls and inputs sitting on a card use `backgroundSelected`.

**All selection controls go through `<SelectChip>`.** Selected is a solid `accent` fill, not a tinted outline: the tinted version was nearly the same value as the dark card behind it. If you need a new selector, use this component rather than restyling a `Pressable`.

**Don't scale a full-width element to animate it.** The check-in pop originally scaled the whole habit row, which pushed it past the screen edges and clipped its corners; it now scales only the badge. Transition animations must also skip the mount pass, or every already-complete habit animates on load.

## Conventions

- **Routes live in `src/app/`, not `app/`** (the stock README says `app/` — it's wrong for this repo).
- Import via the `@/*` alias → `src/*`, and `@/assets/*` → `assets/*`.
- Typed routes are enabled. Route types are generated into `.expo/types` **by running the dev server**. After adding or renaming a route, `npx tsc --noEmit` fails on the old route union until the dev server regenerates them — start it, don't hand-edit.
- `expo-env.d.ts` is generated and gitignored, but typecheck fails without it (it declares the CSS-module and `*.css` types). A fresh clone needs one dev-server run before `tsc` passes.
- Theme colors live in `src/constants/theme.ts`. Every key must exist in **both** `light` and `dark` — the `ThemeColor` type is their intersection, and adding to one only will break `ThemedText`/`ThemedView` consumers.
- React Compiler is enabled (`experiments.reactCompiler`), so keep render paths free of mutation.
