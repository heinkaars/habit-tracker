// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Keeps the assumption that makes web session storage safe.
    //
    // Supabase sessions persist through AsyncStorage, which on web is
    // `window.localStorage` — readable by any script on the origin rather than
    // httpOnly. `src/lib/supabase.ts` accepts that deliberately, because
    // httpOnly cookies would need `@supabase/ssr` and a server session route
    // and `web.output` is "static", so there is no server to host one.
    //
    // What makes it safe is not the storage choice. It is that the XSS surface
    // is empty by construction: everything renders through <ThemedText> → RN
    // <Text>, which escapes, and nothing under src/ reaches raw HTML or eval.
    // That is a property of the current code, so the comment in supabase.ts
    // asks the reader to treat any change introducing raw HTML on web as
    // reopening the question. This makes that a failing lint rather than a
    // request — the refresh token is what is on the other side of it.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message:
            "Raw HTML would give an XSS payload access to the Supabase refresh token in localStorage on web. See the storage note in src/lib/supabase.ts before removing this rule.",
        },
        {
          selector:
            'MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]',
          message:
            "Raw HTML would give an XSS payload access to the Supabase refresh token in localStorage on web. See the storage note in src/lib/supabase.ts before removing this rule.",
        },
        {
          selector: 'NewExpression[callee.name="Function"]',
          message: "Dynamic code execution is not used in this app; see src/lib/supabase.ts.",
        },
      ],
    },
  },
]);
