import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { loadConfig } from "../load.js";

describe("@gmacko/config loadConfig", () => {
  it("loads valid env vars against a schema", async () => {
    const schema = Schema.Struct({
      DATABASE_URL: Schema.String,
      PORT: Schema.NumberFromString,
    });

    const env = { DATABASE_URL: "postgres://local", PORT: "3000" };
    const result = await Effect.runPromise(loadConfig(schema, env));
    expect(result).toEqual({ DATABASE_URL: "postgres://local", PORT: 3000 });
  });

  it("fails loudly on missing required var", async () => {
    const schema = Schema.Struct({ DATABASE_URL: Schema.String });
    const result = Effect.runPromise(loadConfig(schema, {}));
    await expect(result).rejects.toThrow();
  });
});
