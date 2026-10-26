import { useRef, useState } from 'react';
import { PersonFace } from '../components/PersonFace';
import { usePersonName } from './personName';
import { useCall } from './runtime';
import { useFeedbackSheet } from '../features/feedback/useFeedbackSheet';
import { LazyPersonMenuPanel, warmPersonMenuPanel } from './overlays';

/**
 * The person's picture opens their name and the menu in two groups (fbk_063, owner 2026-10-26). Group 1 holds the three quick choices:
 * Away, Mode (light or dark) and Language, each a label with its control. Group 2 holds the places: Admin, Settings, What's new and the
 * feedback sheet. The prototype adds Preview as under the header; the real build adds Sign out alone at the end (plan 5.1).
 * The panel is a chunk of its own (`PersonMenuPanel.tsx`): this file keeps the picture, the open state and the feedback sheet. The
 * chunk starts to load at idle and at the first press or focus on the picture, so a fast press finds it in memory.
 */
export function PersonMenu({ id }: { id: string }) {
  const nameOf = usePersonName();
  const user = useCall('session.get', {}).data?.user;
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // The feedback sheet loads in its own chunk (FL-4): it mounts at the first open and stays, so its closing animation stays.
  const feedback = useFeedbackSheet();
  if (!user) return null;
  const close = () => {
    setOpen(false);
    ref.current?.focus();
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={nameOf(user)}
        aria-expanded={open}
        onPointerDown={warmPersonMenuPanel}
        onFocus={warmPersonMenuPanel}
        onClick={() => setOpen((value) => !value)}
        className="pressable grid size-11 place-items-center rounded-full"
      >
        <PersonFace user={user} size={36} mine />
      </button>
      {open && ref.current && (
        <LazyPersonMenuPanel id={id} anchor={ref.current} onClose={close} onLeave={() => setOpen(false)} onFeedback={feedback.open} />
      )}
      {feedback.sheet}
    </>
  );
}
