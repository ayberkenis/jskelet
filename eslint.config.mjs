import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/public/assets/**",
      "**/.jskelet/**",
      "src/client/devtools/**",
    ],
  },

  js.configs.recommended,

  {
    // Sunucu, build ve CLI kodu.
    files: [
      "src/**/*.{js,mjs}",
      "bin/**/*.mjs",
      "examples/*/routes/**/*.mjs",
      "examples/*/lib/**/*.js",
      "examples/*/*.mjs",
      "test/**/*.mjs",
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^(req|res|next|_)" }],
    },
  },

  {
    // Island'lar ve tarayıcıda çalışan runtime.
    files: ["src/client/**/*.js", "examples/*/client/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },

  {
    // Bileşenler hem sunucuda hem şablonda; DOM yok ama Node var.
    files: ["examples/*/views/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
