export default [
  {
    files: ["src/**/*.js", "ui/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        globalThis: "readonly", window: "readonly", document: "readonly", location: "readonly",
        URL: "readonly", CSS: "readonly", fetch: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
        AbortController: "readonly", TextDecoder: "readonly", IntersectionObserver: "readonly",
        MutationObserver: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Use textContent / DOM APIs." },
        { property: "outerHTML", message: "Use textContent / DOM APIs." },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: "Use DOM APIs." },
        { selector: "CallExpression[callee.property.name='write']", message: "No document.write." },
      ],
    },
  },
];
