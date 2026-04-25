// @gmacko/storage — Phase 6L peripheral package stub.
//
// Public surface:
//   - `Storage` — Effect service with put/get/delete/list, driver-agnostic.
//   - `layerStorageStub` — Layer that fails every method with `StorageNotImplementedError`.
//   - Tagged error: `StorageNotImplementedError`.
//   - Types: `StorageObject`, `StorageShape`.
//
// Real implementation deferred to Phase 7 (Bob migration). Drivers (S3, R2,
// local FS) will land per concrete consumer needs.
import { Effect, Layer, Schema, ServiceMap } from "effect";

export interface StorageObject {
  readonly key: string;
  readonly size: number;
  readonly contentType?: string;
  readonly etag?: string;
  readonly updatedAt: Date;
}

export class StorageNotImplementedError extends Schema.TaggedErrorClass<StorageNotImplementedError>()(
  "StorageNotImplementedError",
  {
    reason: Schema.String,
    key: Schema.optional(Schema.String),
  },
) {}

export interface StorageShape {
  readonly put: (
    key: string,
    body: ArrayBuffer | Uint8Array,
    contentType?: string,
  ) => Effect.Effect<StorageObject, StorageNotImplementedError>;
  readonly get: (
    key: string,
  ) => Effect.Effect<
    { body: Uint8Array; meta: StorageObject },
    StorageNotImplementedError
  >;
  readonly delete: (
    key: string,
  ) => Effect.Effect<void, StorageNotImplementedError>;
  readonly list: (
    prefix: string,
  ) => Effect.Effect<readonly StorageObject[], StorageNotImplementedError>;
}

export const Storage = ServiceMap.Service<StorageShape>(
  "@gmacko/storage/Storage",
);

const reason = "@gmacko/storage: deferred to Phase 7 (Bob migration)";
const fail = (
  key?: string,
): Effect.Effect<never, StorageNotImplementedError> =>
  Effect.fail(new StorageNotImplementedError({ reason, key }));

export const layerStorageStub: Layer.Layer<StorageShape> = Layer.succeed(
  Storage,
  {
    put: (key) => fail(key),
    get: (key) => fail(key),
    delete: (key) => fail(key),
    list: () => fail(),
  },
);

/** Package version/phase sentinel — kept for the 6L smoke test. */
export const __gmackoStoragePhase = "6l" as const;
