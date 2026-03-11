import { vi } from "vitest";

export interface FakeDatabaseCalls {
  select: number;
  update: number;
  insert: number;
  insertValues: number;
  updateSet: number;
  updateWhere: number;
}

export interface FakeDatabase {
  db: {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };
  calls: FakeDatabaseCalls;
  insertValues: unknown[];
}

function createSelectChain<T>(value: T[]) {
  const chain: {
    from: () => typeof chain;
    where: () => typeof chain;
    orderBy: () => typeof chain;
    limit: () => typeof chain;
    then: <U>(onfulfilled?: ((value: T[]) => U | PromiseLike<U>) | null, onrejected?: ((reason: unknown) => U | PromiseLike<U>) | null) => Promise<U>;
    catch: <U>(onrejected?: ((reason: unknown) => U | PromiseLike<U>) | null) => Promise<T[] | U>;
  } = {} as unknown as any;

  chain.from = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve, reject) =>
    Promise.resolve(value as T[]).then(resolve, reject);
  chain.catch = (onrejected) => Promise.resolve(value).catch(onrejected);

  return chain;
}

function createUpdateChain<T>(value: T[]) {
  const chain: {
    set: () => typeof chain;
    where: () => { returning: () => Promise<T[]> };
    returning: () => Promise<T[]>;
  } = {} as unknown as any;

  chain.set = () => chain;
  chain.where = () => ({
    returning: () => Promise.resolve(value),
  });
  chain.returning = () => Promise.resolve(value);

  return chain;
}

export function createFakeDatabase({
  selectResponses = [],
  updateResponses = [],
}: {
  selectResponses?: unknown[][];
  updateResponses?: unknown[][];
} = {}): FakeDatabase {
  const calls: FakeDatabaseCalls = {
    select: 0,
    update: 0,
    insert: 0,
    insertValues: 0,
    updateSet: 0,
    updateWhere: 0,
  };

  const selectQueue = [...selectResponses];
  const updateQueue = [...updateResponses];
  const insertValues: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      calls.select += 1;
      const next = selectQueue.shift() ?? [];
      return createSelectChain(next);
    }),
    update: vi.fn(() => {
      calls.update += 1;
      calls.updateSet += 1;
      const next = updateQueue.shift() ?? [];
      const chain = createUpdateChain(next);
      const originalWhere = chain.where;
      chain.where = () => {
        calls.updateWhere += 1;
        return originalWhere();
      };
      return chain;
    }),
    insert: vi.fn(() => {
      calls.insert += 1;
      return {
        values: (value: unknown) => {
          calls.insertValues += 1;
          insertValues.push(value);
          const next = {
            ...(value as Record<string, unknown>),
            id: (value as { id?: string }).id ?? "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          };
          return {
            returning: () => [next],
          };
        },
      };
    }),
  };

  return { db, calls, insertValues };
}
