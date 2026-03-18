# Task: [Component Name]

## Intent
[What are we building?]

## Context
[Where it appears, who uses it, and what job it does]

## Required States
- happy path
- loading
- empty
- error
- success

## Edge Cases
- long text
- null or partial data
- malformed values
- slow network
- overflow or truncation

## UX Goals
- clarity
- feedback
- confidence
- responsiveness

## Deliverables
- React + TypeScript component
- Storybook stories
- Mock data fixtures

## Prompt Payload
Build a [COMPONENT] for [CONTEXT].

Requirements:
- Must support: [STATE LIST]
- Must handle edge cases: [EDGE CASES]
- Must be accessible: [A11Y RULES]
- Must be responsive: [BREAKPOINTS]

Generate:
1. Component (React + TypeScript)
2. Storybook stories:
   - all meaningful states
   - edge cases
   - failure modes
3. Mock data:
   - realistic data
   - adversarial data
