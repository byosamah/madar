import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { setNow } from '../lib/dates';

afterEach(() => {
  cleanup();
  setNow(null);
});
