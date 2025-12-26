import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    "node_modules/**",
    "dist/**",
    "coverage/**",

    // project-specific
    "mobile/**",
    ".android/**",
    ".app-store/**",
  ]),

  // Project policy: allow pragmatic typing while we iterate.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/prefer-as-const": "warn",

      // keep signal, but don't block
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // Next/React server components often legitimately use Date.now() etc.
      "react-hooks/purity": "off",
    },
  },
]);
