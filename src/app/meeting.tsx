import { createContext, useContext, type ReactNode } from 'react';

/**
 * What a screen knows while the team meets. `startedAt` is an ISO stamp in office time: when the meeting session of the day started.
 * `drafts` holds the text that people typed and did not add yet. It lives as long as the meeting screen, so a move to another
 * project never loses it (audit 2026-10-03, DSH-3).
 */
export type MeetingState = { startedAt: string; drafts?: Map<string, string> };

const MeetingContext = createContext<MeetingState | null>(null);

export function MeetingProvider({ value, children }: { value: MeetingState; children: ReactNode }) {
  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>;
}

/** The meeting that holds this screen, or null outside a meeting. */
export function useMeeting(): MeetingState | null {
  return useContext(MeetingContext);
}
