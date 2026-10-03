import type { StoryRef } from './wire';

/** The browser keeps a placeholder's server story for 24 hours, the time the server accepts a story (plan 4.9). */
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

/** Server story IDs start with sty_. Any other correlation ID is a browser placeholder (cor_ui_...). */
export function isServerStory(id: string): boolean {
  return id.startsWith('sty_');
}

type Claim = { request: object; settled: Promise<void>; release: () => void };

/**
 * The map from story placeholders to server story IDs (client map 2.4). The first call with a new placeholder goes as
 * { ref }, and its answer gives the server ID. Calls with the same placeholder in the same request also go as { ref }, because
 * the server maps a ref once for each batch. A call in a later request waits for that answer, so one placeholder never makes
 * two server stories.
 */
export class StoryMap {
  #known = new Map<string, { id: string; at: number }>();
  #claims = new Map<string, Claim>();
  #now: () => number;

  constructor(o: { now?: () => number } = {}) {
    this.#now = o.now ?? Date.now;
  }

  /** How a call with this correlation ID goes on the wire in this request, or what it must wait for first. */
  plan(correlationId: string, request: object): { story: StoryRef } | { wait: Promise<void> } {
    const id = this.serverId(correlationId);
    if (id) return { story: { id } };
    const claim = this.#claims.get(correlationId);
    if (claim && claim.request !== request) return { wait: claim.settled };
    if (!claim) {
      let release: () => void = () => undefined;
      const settled = new Promise<void>((resolve) => { release = resolve; });
      this.#claims.set(correlationId, { request, settled, release });
    }
    return { story: { ref: correlationId } };
  }

  /** The answer for a call sent as { ref }: the server story ID, or undefined when the call failed with none. */
  settle(ref: string, storyId: string | undefined): void {
    if (storyId) this.#known.set(ref, { id: storyId, at: this.#now() });
    const claim = this.#claims.get(ref);
    if (!claim) return;
    this.#claims.delete(ref);
    claim.release();
  }

  /** The server story ID for a correlation ID, when known. */
  serverId(correlationId: string): string | undefined {
    if (isServerStory(correlationId)) return correlationId;
    const known = this.#known.get(correlationId);
    if (!known) return undefined;
    if (this.#now() - known.at > STORY_TTL_MS) {
      this.#known.delete(correlationId);
      return undefined;
    }
    return known.id;
  }
}
