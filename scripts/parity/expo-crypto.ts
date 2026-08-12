/**
 * Stands in for `expo-crypto` when the parity test runs under Node.
 *
 * `src/lib/habits.ts` imports `@/lib/ids`, which imports `expo-crypto` — a
 * native module that cannot load outside React Native (it fails on
 * `requireNativeModule`). The parity test only exercises pure date and streak
 * logic, which never generates an id, so a stub is enough to make the module
 * importable. `tsconfig.json` in this folder maps the specifier here.
 */
export function randomUUID(): string {
  return '00000000-0000-4000-8000-000000000000';
}
