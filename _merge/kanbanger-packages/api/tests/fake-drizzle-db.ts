import { vi } from "vitest";

export interface FakeQueryCounts {
  selectCalls: number;
  updateCalls: number;
  insertCalls: number;
}

export function createFakeDatabase({
  selectResponses = [],
  updateResponses = [],
}: {
  selectResponses?: unknown[][];
  updateResponses?: unknown[][];
}) {
  const counts: FakeQueryCounts = {
    selectCalls: 0,
    updateCalls: 0,
    insertCalls: 0,
  };

  const selectQueue = [...selectResponses];
  const updateQueue = [...updateResponses];

  const createSelectChain = <T>(value: T[]) => {
    const chain: {
      from: () => typeof chain;
      where: () => typeof chain;
      orderBy: () => typeof chain;
      limit: () => typeof chain;
      then: (resolve: (value: T[]) => void, reject?: (error: unknown) => void) => Promise<unknown>;
    } = {} as unknown as any;

    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = () => chain;
    chain.then = (resolve, reject) =>
      Promise.resolve(value).then(resolve as never, reject as never);

    return chain;
  };

  const createUpdateChain = <T>(value: T[]) => {
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
  };

  const createInsertChain = () => {
    counts.insertCalls += 1;
    return {
      values: () => {},
    };
  };

  return {
    db: {
      select: vi.fn(() => {
        counts.selectCalls += 1;
        const next = selectQueue.shift() ?? [];
        return createSelectChain(next);
      }),
      update: vi.fn(() => {
        counts.updateCalls += 1;
        const next = updateQueue.shift() ?? [];
        return createUpdateChain(next);
      }),
      insert: vi.fn(createInsertChain),
    },
    calls: counts,
  };
}
