import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Artefactos de build. Van todos los que produce el proyecto y no sólo
  // algunos: `.vercel` faltaba y, apenas se construyó con el preset de Vercel,
  // ESLint se puso a lintear los bundles generados — 68.091 errores de prettier
  // sobre código que nadie escribió, que tapaban los 7 avisos reales del código
  // fuente.
  //
  // La lista espeja la del .gitignore a propósito: si algo no va al repo porque
  // se regenera, tampoco tiene sentido lintearlo.
  {
    ignores: [
      "dist",
      "dist-ssr",
      ".output",
      ".vinxi",
      ".vercel",
      ".nitro",
      ".tanstack",
      ".wrangler",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);
