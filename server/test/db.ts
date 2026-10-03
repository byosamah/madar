import { afterEach } from 'vitest';
import { setNow } from '../../src/lib/dates';

/**
 * The setup file of the db project (plan 7.2). Track D1 replaces this stub with the database harness: one schema for each worker,
 * one transaction for each test, a rollback after each test. Keep the clock reset: many API tests call setNow without their own reset.
 */
afterEach(() => {
  setNow(null);
});
