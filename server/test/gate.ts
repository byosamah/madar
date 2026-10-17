import type { TestContext } from 'vitest';

/**
 * The test gate. A test that times out leaves its calls running; after the ROLLBACK they would run with no test transaction, so
 * they would commit for real and break the next test. So each backend binds to the test that first uses it, a call after that
 * test ended fails at once, and the end of a test waits for the database step that still runs before the ROLLBACK.
 */
export type Gate = {
  start(testId: string): void;
  end(): Promise<void>;
  /** A wrapper for the database steps of one backend. */
  binding(): <T>(work: () => Promise<T>) => Promise<T>;
};

export function createGate(): Gate {
  let current: string | undefined;
  const inflight = new Set<Promise<unknown>>();
  return {
    start(testId) {
      current = testId;
    },
    async end() {
      current = undefined;
      while (inflight.size > 0) await Promise.allSettled([...inflight]);
    },
    binding() {
      let bound: string | undefined;
      return async <T>(work: () => Promise<T>): Promise<T> => {
        if (current === undefined || (bound !== undefined && bound !== current)) {
          throw new Error('db mode: this call came after its test ended, so it does not touch the database.');
        }
        bound ??= current;
        const running = work();
        inflight.add(running);
        try {
          return await running;
        } finally {
          inflight.delete(running);
        }
      };
    },
  };
}

/** The full name of a test as Vitest prints it: the describe names and the test name, joined by spaces. */
export function fullName(task: TestContext['task']): string {
  const names = [task.name];
  for (let suite = task.suite; suite && suite !== (task.file as unknown); suite = suite.suite) if (suite.name) names.unshift(suite.name);
  return names.join(' ');
}
