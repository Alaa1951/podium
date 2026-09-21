import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react/no-unescaped-entities": "warn",
      "prefer-const": "warn",
    },
  },
  // CommonJS by design (Node entrypoint + one-off scripts) and deliberate
  // conditional require() in tests — require() is intentional here.
  {
    files: ["server.js", "scripts/**/*.mjs", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Deployment package output (scripts/prepare-hostinger-package.mjs)
    "dist-hostinger/**",
    ".mobile-qa/**",
    // Scratch from a local QA run: probe scripts and one-off seeds. Gitignored
    // already, but eslint does not read .gitignore, so a tester's leftovers
    // would otherwise turn `npm run verify` yellow on a clean tree.
    ".tmp-qa/**",
    ".tmp-*",
    "capacitor-web/capacitor.js",
    "android/app/src/main/assets/public/**",
    "ios/App/App/public/**",
  ]),
]);

export default eslintConfig;
