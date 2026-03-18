import type { BuiltinSkill } from "./bob-workflow-skill.js";

export const createGmackoAppFeatureDevelopmentSkill: BuiltinSkill = {
  name: "create-gmacko-app-feature-development",
  description:
    "Feature placement guidance for create-gmacko-app repos. Use when an agent needs to know where code belongs across apps/nextjs, packages/ui, packages/api, packages/db, helpers, and shared packages so feature work stays uniform.",
  template: `# Create Gmacko App Feature Development

Use this when implementing a feature inside a create-gmacko-app repo.

## Core Rule

Place code in the narrowest correct layer first, then promote it only when reuse is real.

## Package Map

- \`apps/nextjs\`: routes, page composition, app-specific providers, app-only hooks
- \`packages/ui\`: reusable UI primitives, shared components, stories
- \`packages/api\`: routers, procedures, domain services, integration orchestration
- \`packages/db\`: schema, migrations, seeds, persistence helpers
- \`apps/nextjs\` + Playwright: repeatable web end-to-end coverage
- \`apps/expo/.maestro\`: mobile end-to-end flows for Expo
- \`docs/ai\`: proposal and implementation artifacts

## Helper Rules

- Keep helpers close to the layer they serve
- Move them to a layer-local helper module only after reuse inside that layer appears
- Promote to a shared package only when at least two consumers or a stable platform concern justify it
- Avoid generic \`utils\` buckets with mixed ownership

## Validation Stack

- Use Playwright for deterministic web flows in \`apps/nextjs\`
- Use \`gstack /browse\` for browser QA and visual verification
- Use Maestro from \`apps/expo/.maestro\` for mobile end-to-end flows
- Treat \`/browse\` as the fast inspection loop and Playwright or Maestro as the durable regression layer

## Standard Flow

1. Confirm intent in \`docs/ai\`
2. Split the feature by layer
3. Land shared UI in \`packages/ui\` first when needed
4. Wire the experience in \`apps/nextjs\`
5. Put API behavior in \`packages/api\`
6. Put schema and persistence changes in \`packages/db\`
7. Update stories when shared UI changes
8. Decide whether the feature needs Playwright, \`/browse\`, and Maestro coverage

## Avoid

- Reusable components inside \`apps/nextjs\`
- API logic in page files
- DB transforms in router files
- Premature extraction into shared packages
- Catch-all helper files with no clear owner
- React flow changes with no browser or mobile validation plan
`,
};
