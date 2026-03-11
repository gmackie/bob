type ValidationSuccess<T> = { success: true; data: T; error?: undefined };
type ValidationFailure = { success: false; error: Error };
type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

interface BaseSchema<T> {
  __output: T;
  safeParse(value: unknown): ValidationResult<T>;
  parse(value: unknown): T;
  optional(): BaseSchema<T | undefined>;
  nullable(): BaseSchema<T | null>;
  default(defaultValue: T): BaseSchema<T>;
  pipe<U>(other: BaseSchema<U>): BaseSchema<U>;
  transform<U>(transformer: (value: T) => U): BaseSchema<U>;
}

type EnumValue = string;

interface StringSchema extends BaseSchema<string> {
  min(_: number): StringSchema;
  max(_: number): StringSchema;
  uuid(): StringSchema;
  email(): StringSchema;
  url(): StringSchema;
}

interface ObjectSchema<T> extends BaseSchema<T> {
  and(schema: ObjectSchema<T>): ObjectSchema<T>;
  partial(): ObjectSchema<Partial<T>>;
  omit(_: Record<string, true>): ObjectSchema<Partial<T>>;
  refine(_: (value: T) => boolean | Promise<boolean>, params?: { message: string; path?: string[] }): ObjectSchema<T>;
  superRefine(_: (value: T, ctx: { addIssue: (...args: unknown[]) => void }) => void): ObjectSchema<T>;
  transform<U>(transformer: (value: T) => U): BaseSchema<U>;
}

interface ArraySchema<T> extends BaseSchema<T[]> {
  min(_: number): ArraySchema<T>;
}

interface RecordSchema<T> extends BaseSchema<Record<string, T>> {}

interface UnionSchema<T> extends BaseSchema<T> {
  or(other: UnionSchema<T>): UnionSchema<T>;
}

function createSchema<T>(parser: (value: T) => T, options: { defaultValue?: T } = {}): BaseSchema<T> {
  const parseValue: (value: unknown) => T = (value) => parser((value ?? options.defaultValue) as T);

  const schema: BaseSchema<T> = {
    __output: undefined as T,
    safeParse(value) {
      try {
        return { success: true, data: parseValue(value) };
      } catch (error) {
        return { success: false, error: error as Error };
      }
    },
    parse(value) {
      const parsed = parseValue(value);
      if (parsed === undefined) {
        throw new Error("Invalid value");
      }

      return parsed;
    },
    optional() {
      return createSchema((value) => (value === undefined ? undefined : parser(value as T))) as BaseSchema<
        T | undefined
      >;
    },
    nullable() {
      return createSchema<T | null>((value) => (value === null ? null as T : parseValue(value as unknown)));
    },
    default(defaultValue: T) {
      return createSchema(parser, { defaultValue });
    },
    pipe<U>(other: BaseSchema<U>) {
      return createSchema((value) => other.parse(schema.parse(value as unknown)));
    },
    transform<U>(transformer) {
      return {
        ...schema,
        safeParse(value) {
          const parsed = schema.safeParse(value);
          if (!parsed.success) {
            return parsed as ValidationFailure;
          }

          return {
            success: true,
            data: transformer(parsed.data),
          };
        },
        parse(value) {
          return transformer(schema.parse(value));
        },
        __output: undefined as unknown as U,
      } as BaseSchema<U>;
    },
  };

  return schema;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stringParser(value: string): string {
  if (value === undefined || value === null) {
    throw new Error("Invalid value");
  }

  if (typeof value !== "string") {
    throw new Error("Invalid value");
  }

  return value;
}

const z = {
  unknown() {
    return createSchema((value) => value);
  },
  object<T>(shape: Record<string, unknown>): ObjectSchema<T> {
    const schema = createSchema<T>((value) => {
      if (value === undefined || value === null || typeof value !== "object") {
        throw new Error("Invalid value");
      }

      const input = value as Record<string, unknown>;
      const output: Record<string, unknown> = { ...input };

      for (const [key, fieldSchema] of Object.entries(shape)) {
        if (
          fieldSchema &&
          typeof fieldSchema === "object" &&
          "safeParse" in fieldSchema &&
          typeof (fieldSchema as BaseSchema<unknown>).safeParse === "function"
        ) {
          const schema = fieldSchema as BaseSchema<unknown>;
          if (key in input) {
            const parsedValue = schema.safeParse(input[key]);
            if (parsedValue.success) {
              output[key] = parsedValue.data;
            }
            continue;
          }

          const defaultValue = schema.safeParse(undefined);
          if (defaultValue.success && defaultValue.data !== undefined) {
            output[key] = defaultValue.data;
          }
        }
      }

      return output as T;
    });

    const objectSchema: ObjectSchema<T> = {
      ...schema,
      and: () => objectSchema,
      partial: () => objectSchema as ObjectSchema<Partial<T>>,
      omit: () => objectSchema as ObjectSchema<Partial<T>>,
      superRefine: (_callback: (value: T, ctx: { addIssue: (...args: unknown[]) => void }) => void) =>
        objectSchema as ObjectSchema<T>,
      refine: () => objectSchema as ObjectSchema<T>,
      transform: <U>(transformer: (value: T) => U) => {
        const base = schema as BaseSchema<T>;
        const transformed = {
          ...base,
          safeParse(value) {
            const parsed = base.safeParse(value);
            if (!parsed.success) {
              return parsed as ValidationFailure;
            }
            return {
              success: true,
              data: transformer(parsed.data),
            };
          },
          parse(value) {
            return transformer(base.parse(value));
          },
          __output: undefined as unknown as U,
        } as BaseSchema<U>;

        const transformedObject = {
          ...(transformed as BaseSchema<U>),
          and: () => transformedObject as ObjectSchema<U>,
          partial: () => transformedObject as ObjectSchema<Partial<U>>,
          omit: () => transformedObject as ObjectSchema<Partial<U>>,
          refine: () => transformedObject as ObjectSchema<U>,
          superRefine: () => transformedObject as ObjectSchema<U>,
          transform: objectSchema.transform,
          pipe: (next) => transformed.pipe(next),
        };

        return transformedObject as ObjectSchema<U>;
      },
    };

    return objectSchema;
  },
  string() {
    const create = (check: (value: string) => boolean = () => true) => {
      const schema = createSchema((value) => {
        const parsed = stringParser(value);
        if (!check(parsed)) {
          throw new Error("Invalid value");
        }
        return parsed;
      }) as StringSchema;

      const wrapped = {
        ...schema,
        min: () => schema,
        max: () => schema,
        uuid() {
          return create((value) => uuidPattern.test(value)) as StringSchema;
        },
        email() {
          return create(() => true);
        },
        url() {
          return create(() => true);
        },
      };

      return wrapped as StringSchema;
    };

    return create();
  },
  enum<TValues extends readonly [EnumValue, ...EnumValue[]]>(values: TValues) {
    return createSchema((value) => {
      const parsed = stringParser(value as string);
      if (!values.includes(parsed as TValues[number])) {
        throw new Error("Invalid value");
      }
      return parsed as TValues[number];
    }) as BaseSchema<TValues[number]>;
  },
  array<T>(_inner: BaseSchema<T>) {
    const schema = createSchema((value) => {
      if (!Array.isArray(value)) {
        throw new Error("Invalid value");
      }

      return value as T[];
    });

    return {
      ...schema,
      min: () => schema as ArraySchema<T>,
    };
  },
  record<T>(_value: BaseSchema<T>) {
    return createSchema((value) => {
      if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Invalid value");
      }

      return value as Record<string, T>;
    }) as RecordSchema<T>;
  },
  union<T>(schemas: BaseSchema<T>[]) {
    const schema = createSchema((value) => {
      for (const current of schemas) {
        const parsed = current.safeParse(value);
        if (parsed.success) {
          return parsed.data;
        }
      }

      throw new Error("Invalid value");
    });

    return {
      ...schema,
      or: () => schema,
    } as UnionSchema<T>;
  },
  date() {
    return createSchema((value) => {
      if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw new Error("Invalid value");
      }

      return value;
    }) as BaseSchema<Date>;
  },
  preprocess<T>(transformer: (value: unknown) => unknown, schema: BaseSchema<T>) {
    return createSchema((value) => schema.parse(transformer(value)));
  },
  ZodIssueCode: {
    custom: "custom",
  },
} as const;

export { z };
export type infer<T> = T extends { __output: infer R } ? R : never;
