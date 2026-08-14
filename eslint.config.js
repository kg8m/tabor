import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import pluginPromise from "eslint-plugin-promise";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist"] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      importX.flatConfigs.recommended,
      importX.flatConfigs.typescript,
      unicorn.configs.recommended,
      pluginPromise.configs["flat/recommended"],
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, chrome: "readonly" },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // `parentId: number | null` uses `null` on purpose to mean "no parent".
      "unicorn/no-null": "off",
      // `e` is used as a short-lived local variable name (e.g. a tree node
      // called "E" in tests), not as an abbreviation for "error"/"event".
      "unicorn/name-replacements": ["error", { replacements: { e: false } }],
      // React component files conventionally use PascalCase.
      "unicorn/filename-case": [
        "error",
        { cases: { kebabCase: true, pascalCase: true } },
      ],
    },
  },
  {
    // chrome.* event listeners are typed as returning `void`, but MV3
    // service workers rely on listeners returning a Promise to stay alive
    // until async work (e.g. chrome.storage writes) finishes. Passing an
    // async function there is intentional, not a mistake—but only in this
    // file, where those listeners are registered; elsewhere this rule
    // should still catch a Promise passed where void was expected.
    files: ["src/background/index.ts"],
    rules: {
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { arguments: false } },
      ],
    },
  },
  eslintConfigPrettier,
);
