import { createContext, useContext, type ReactNode } from 'react';

/** What a screen knows while the team meets. `startedAt` is an ISO stamp. */
export type MeetingState = { startedAt: string };

const MeetingContext = createContext<MeetingState | null>(null);

export function MeetingProvider({ value, children }: { value: MeetingState; children: ReactNode }) {
  return <MeetingContext.Provider value={value}>{children}</MeetingContext.Provider>;
}

/** The meeting that holds this screen, or null outside a meeting. */
export function useMeeting(): MeetingState | null {
  return useContext(MeetingContext);
}
