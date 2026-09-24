import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      // Express handlers that pass errors via next() can return void while
      // being async internally; keep it pragmatic.
      "@typescript-eslint/no-misused-promises": "off",
      // Error-handling middleware must keep 4 params for Express to detect it;
      // underscore-prefixed arguments are intentionally unused.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  prettier
);
