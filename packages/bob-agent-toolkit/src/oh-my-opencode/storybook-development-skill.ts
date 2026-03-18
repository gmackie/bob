import type { BuiltinSkill } from "./bob-workflow-skill.js";

export const storybookDevelopmentSkill: BuiltinSkill = {
  name: "storybook-development",
  description:
    "State-first Storybook workflow for Bob-managed UI work. Use when generating or reviewing React components that need exhaustive state coverage, edge-case fixtures, and prompt-driven iteration.",
  template: `# Storybook Development

Treat UI code as disposable and UI state coverage as the durable asset.

Use this when building or iterating on React UI in Bob with Storybook.

## Workflow

1. Start with a structured task:
   - Intent
   - Context
   - Required States
   - Edge Cases
   - UX Goals
   - Deliverables
   - Prompt Payload
2. Enumerate the full state space before generating code.
3. Generate component, stories, and fixtures together.
4. Review visually in Storybook first.
5. Re-prompt before preferring manual code edits.

## Required Story Categories

- Happy path
- Loading
- Error variants
- Empty
- Edge cases
- Responsive variants
- Accessibility variants

Prefer state-based names such as \`Error_InvalidEmail_Retryable\` and \`Empty_NoResults_FirstTimeUser\`.

## Required Prompt Moves

- State expansion: list happy path, loading, error variants, empty, partial data, slow network, invalid input, and edge UX cases
- UX exploration: request multiple UX variants with distinct density and tone
- Adversarial data: include long text, null fields, malformed data, multilingual strings, and emoji-heavy copy
- UX review: critique stories for clarity, accessibility, and missing states

## Avoid

- Story names like \`Default\` or \`Variant1\`
- Happy-path-only coverage
- Realistic-only fixtures with no adversarial data
- Fixing code while leaving the prompt/spec wrong
`,
};
