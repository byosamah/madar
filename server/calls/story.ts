import { notBuiltAsync } from '../core/notBuilt';
import type { ServerCall } from '../core/types';

/** story.start: a new server story ID (plan 4.9). Track C3 replaces this stub. */
export const storyStart: ServerCall<'story.start'> = () => notBuiltAsync('story.start');
