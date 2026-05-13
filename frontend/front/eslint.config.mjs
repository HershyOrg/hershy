import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "build/**",
      "out/**",
      "node_modules/**",
      ".local/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      "check_*.js",
      "fix*.js",
      "intersect_check.js",
      "test-*.js",
      "test_*.js",
      "update*.js",
    ],
  },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "prefer-const": "warn",
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default config;
