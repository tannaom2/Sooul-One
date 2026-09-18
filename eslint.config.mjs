import nextConfig from "eslint-config-next";

/**
 * eslint-config-next@16 ships a native flat-config array (dist/index.js
 * exports an array of config objects, importable as-is) rather than the
 * legacy .eslintrc-shaped object older versions used.
 *
 * The first draft of this file bridged it through FlatCompat, which is the
 * standard adapter for legacy configs — but bridging an object that is
 * ALREADY flat re-wraps plugin objects that self-reference their own
 * `configs.flat` property, and @eslint/eslintrc's schema validator tries to
 * JSON.stringify that object while formatting an error, which throws on the
 * circular reference before the real lint even runs. The fix is not "ignore
 * the error" — it's "don't take the legacy path for a package that no longer
 * needs it".
 */
export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      // Next's own auto-generated, "do not edit" ambient declaration file.
      // ESLint already skips it when targeted directly (it reports "ignored
      // because of a matching ignore pattern" on its own) — but included via
      // this project's full recursive glob walk, the same file instead
      // reaches @typescript-eslint's parser and crashes ESLint 10.10.0's core
      // with "scopeManager.addGlobals is not a function". Bisected by linting
      // every directory and file individually until this was the one file
      // whose absence made the full run clean; isolated, it behaves exactly
      // as the "already ignored" message promises. That gap between how a
      // glob-discovered file and an explicitly-named file are checked against
      // ignore patterns is an upstream inconsistency, not something to code
      // around by downgrading a still-current, actively developed tool.
      // Excluding it here is the same outcome ESLint intends by default, made
      // to actually hold during a full-project run.
      "next-env.d.ts",
    ],
  },
  ...nextConfig,
  {
    // Scoped to the same glob eslint-config-next uses when it registers the
    // @typescript-eslint plugin (index 1 of its own array) — an override
    // object with no `files` key does not inherit an earlier object's plugin
    // registration in flat config, so referencing the rule unscoped fails at
    // config-load time with "could not find plugin", before any file is even
    // linted.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      // The Prisma-shape `any` in server files (see the eslint-disable
      // comments in src/server and src/app/admin) is a deliberate, narrow
      // escape for un-typed query results in this sandbox build — not a
      // general licence, hence left as warn rather than off.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];
