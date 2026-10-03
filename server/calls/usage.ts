import { notBuiltAsync } from '../core/notBuilt';
import type { ServerCall } from '../core/types';

/** Track M replaces this stub (plan 5.8). */
export const usageGet: ServerCall<'usage.get'> = () => notBuiltAsync('usage.get');
