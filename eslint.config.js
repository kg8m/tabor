import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import jsdoc from "eslint-plugin-jsdoc";
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
      jsdoc.configs["flat/recommended-typescript"],
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
      // `parentId: number | null` uses `null` on purpose to mean “no parent”.
      "unicorn/no-null": "off",
      // `e` is used as a short-lived local variable name (e.g. a tree node
      // called “E” in tests), not as an abbreviation for “error”/“event”.
      // `Props` is the standard React naming convention for component prop
      // types, not an abbreviation to spell out.
      "unicorn/name-replacements": [
        "error",
        { replacements: { e: false, props: false } },
      ],
      // React component files conventionally use PascalCase, and hooks use
      // camelCase (e.g. `useWindowTree.ts`).
      "unicorn/filename-case": [
        "error",
        { cases: { kebabCase: true, pascalCase: true, camelCase: true } },
      ],
      // JSDoc blocks here are written the conventional way, with each line
      // prefixed by ` * `. Enforce that instead of the opposite style this
      // rule would impose.
      "unicorn/no-asterisk-prefix-in-documentation-comments": "off",
      "jsdoc/require-asterisk-prefix": "error",
      // A ternary only reads better than `if`/`return` when each branch fits
      // on one line; otherwise it buries a multi-line condition or branch
      // inside an expression.
      "unicorn/prefer-ternary": ["error", "only-single-line"],
    },
  },
  {
    // This project writes JSDoc as prose explaining *why*, not `@param`/
    // `@returns` tags—TypeScript’s own type annotations already say *what*
    // (see e.g. `addTab` in `src/shared/tree/mutations.ts`). The tag-presence
    // rules below would otherwise flag every existing comment as incomplete,
    // so they’re turned off; `require-jsdoc`/`require-description` are what
    // actually enforce “every exported function/type has an explanation”.
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "src/vitest.setup.ts",
      "src/shared/tree/test-helpers.ts",
    ],
    rules: {
      "jsdoc/require-param": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-returns-description": "off",

      // Only exported functions/interfaces/type aliases need a JSDoc block;
      // internal helpers can stay self-explanatory from their name/types.
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: { FunctionDeclaration: true },
          contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"],
        },
      ],
      // `require-jsdoc` only checks presence of a block; this checks it
      // isn’t an empty/near-empty one—interfaces/type aliases need it added
      // explicitly since they aren’t function-like by default.
      "jsdoc/require-description": [
        "error",
        { contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"] },
      ],
      // Catches descriptions that just restate the identifier name (e.g.
      // “Gets the value.” on `getValue`) instead of explaining intent.
      "jsdoc/informative-docs": "warn",
    },
  },
  {
    // The block above only narrows the strict `publicOnly`/description rules
    // it defines itself—`jsdoc/require-jsdoc` from `recommended-typescript`
    // (in the main block’s `extends`) still applies here with its default,
    // non-`publicOnly` settings, since that main block has no `ignores`.
    // Test code isn’t held to the same documentation bar as the rest of the
    // codebase, so turn it off outright rather than fighting the default.
    files: [
      "**/*.test.{ts,tsx}",
      "src/vitest.setup.ts",
      "src/shared/tree/test-helpers.ts",
    ],
    rules: {
      "jsdoc/require-jsdoc": "off",
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
