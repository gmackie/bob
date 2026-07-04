import { join } from "node:path";
import { Effect } from "effect";
import type { HandlerContext } from "../handlers/context.js";
import { wrapHandler } from "../handlers/bridge.js";
import {
  personaCreate,
  personaList,
  personaGet,
  personaUpdate,
  personaDelete,
  personaSyncFromDirectory,
} from "../handlers/persona.js";
import {
  PersonaNotFoundError,
  PersonaReadOnlyError,
} from "@gmacko/core/contracts/schemas/agent-persona";

export const makePersonaRpcHandlers = (ctx: HandlerContext) => ({
  "persona.create": ({
    payload,
  }: {
    payload: {
      name: string;
      slug: string;
      description?: string;
      adapterId: string;
      model?: string;
      systemPrompt?: string;
      allowedTools?: string[];
      autonomyLevel?: string;
      budgetLimitCents?: number;
      metadata?: Record<string, unknown>;
    };
  }) => wrapHandler(personaCreate, ctx, payload, "persona"),

  "persona.list": ({
    payload,
  }: {
    payload: { active?: boolean };
  }) => wrapHandler(personaList, ctx, payload, "persona"),

  "persona.get": ({
    payload,
  }: {
    payload: { id: string };
  }) =>
    Effect.gen(function* () {
      const result = yield* wrapHandler(personaGet, ctx, payload, "persona");
      if (!result) {
        return yield* Effect.fail(
          new PersonaNotFoundError({ personaId: payload.id }),
        );
      }
      return result;
    }),

  "persona.update": ({
    payload,
  }: {
    payload: {
      id: string;
      name?: string;
      description?: string;
      adapterId?: string;
      model?: string;
      systemPrompt?: string;
      allowedTools?: string[];
      autonomyLevel?: string;
      budgetLimitCents?: number;
      metadata?: Record<string, unknown>;
    };
  }) =>
    Effect.gen(function* () {
      const result = yield* wrapHandler(
        personaUpdate,
        ctx,
        payload,
        "persona",
      );
      if (!result.found) {
        return yield* Effect.fail(
          new PersonaNotFoundError({ personaId: payload.id }),
        );
      }
      if ("readOnly" in result && result.readOnly) {
        return yield* Effect.fail(
          new PersonaReadOnlyError({ personaId: payload.id }),
        );
      }
      return (result).persona;
    }),

  "persona.delete": ({
    payload,
  }: {
    payload: { id: string };
  }) =>
    Effect.gen(function* () {
      const result = yield* wrapHandler(
        personaDelete,
        ctx,
        payload,
        "persona",
      );
      if (!result.found) {
        return yield* Effect.fail(
          new PersonaNotFoundError({ personaId: payload.id }),
        );
      }
      if ("readOnly" in result && result.readOnly) {
        return yield* Effect.fail(
          new PersonaReadOnlyError({ personaId: payload.id }),
        );
      }
    }),

  "persona.syncRepo": () =>
    Effect.gen(function* () {
      const personasDir = process.env.BOB_PERSONAS_DIR ?? join(process.cwd(), "docs/personas");
      return yield* wrapHandler(personaSyncFromDirectory, ctx, { directory: personasDir }, "persona");
    }),
});
