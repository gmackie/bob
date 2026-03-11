module.exports = {
  root: true,
  extends: ["@linear-clone/eslint-config/nextjs.js"],
  rules: {
    // Allow unused vars prefixed with _
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "no-unused-vars": "off",
    // React 17+ automatic JSX runtime doesn't require React in scope
    "react/react-in-jsx-scope": "off",
    "no-undef": "off", // TypeScript handles this
  },
};
