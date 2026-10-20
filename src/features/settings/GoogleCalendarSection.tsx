import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../app/errors';
import { PROTOTYPE } from '../../app/mode';
import { useAction, useCall, useRuntime } from '../../app/runtime';
import { useToast } from '../../app/toasts';
import { Button } from '../../components/Button';
import { LoadFailed } from '../../components/LoadFailed';
import { Sheet } from '../../components/Sheet';
import { FormError } from '../auth/AuthPage';
import { SettingsSection as Section } from './Section';

/**
 * Settings, Google Calendar (fbk_022, owner 2026-10-19): one section, the fewest controls. A person connects once. Madar then writes
 * each meeting of that person to the calendar "Madar" in their Google account, and keeps it up to date. Google gets only the title,
 * the time and the place. The prototype has no server, so it shows one line and no control.
 *
 * - The state decides the one control: none gives "Connect Google Calendar" (the main button), ok and not_synced give a quiet
 *   "Disconnect", broken gives "Connect again" (the main button).
 * - Connect asks google.connectStart for the Google address and leaves for it. Google sends the person back through the callback
 *   route of the server to /settings#google=<word>. The section reads that word once and removes the fragment at once (a reload or a
 *   copied address never runs the step again, and the code never stays in the address bar). For the word "finish" it calls
 *   google.connect once with the code and the state of the fragment.
 * - Disconnect asks first (the sheet gives Keep the focus, and Disconnect sits at the start side). It has no Undo: Connect is the way
 *   back. The calendar "Madar" stays in Google, and the person may delete it there.
 */

type Note =
  | { kind: 'denied' | 'failed' | 'old' | 'not_ready' }
  | { kind: 'done'; meetings: number }
  | { kind: 'error'; error: unknown };

const GOOGLE_HOST = 'accounts.google.com';

/** The page goes to the sign-in address of Google only: the server made the address, and this is the last check before the page leaves. */
export function leaveForGoogle(url: string): void {
  window.location.assign(url);
}

function isGoogleAddress(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === GOOGLE_HOST;
  } catch {
    return false;
  }
}

export function GoogleCalendarSection({ leave = leaveForGoogle }: { leave?: (url: string) => void }) {
  const { t } = useTranslation();
  if (PROTOTYPE) {
    return (
      <Section title={t('gcal.title')}>
        <p className="text-body text-label-2">{t('gcal.prototype')}</p>
      </Section>
    );
  }
  return <Google leave={leave} />;
}

/** The word of the fragment as a note. A word that the section does not know reads as failed. */
function noteOfWord(word: string): Note {
  return word === 'denied' || word === 'old' || word === 'not_ready' ? { kind: word } : { kind: 'failed' };
}

function Google({ leave }: { leave: (url: string) => void }) {
  const { t } = useTranslation();
  const { api } = useRuntime();
  const toast = useToast();
  const status = useCall('google.status', {});
  const [note, setNote] = useState<Note | null>(null);
  const [starting, setStarting] = useState(false);
  const [asking, setAsking] = useState(false);

  const connect = useAction('google.connect', {
    onSuccess: (output) => {
      setNote({ kind: 'done', meetings: output.meetings });
      void status.refetch();
    },
    // The section answers a refusal in its own place, with the words of the reason, so no toast shows.
    onRefused: (error) => {
      setNote({ kind: 'error', error });
      return true;
    },
  });
  const disconnect = useAction('google.disconnect', {
    onSuccess: () => {
      setNote(null);
      toast.show({ message: t('gcal.disconnected') });
      void status.refetch();
    },
  });

  // Back from Google: read the word once, take the fragment away at once, then act.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const word = params.get('google');
    if (word === null) return;
    const code = params.get('code');
    const state = params.get('state');
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    if (word === 'finish' && code && state) connect.mutate({ code, state });
    else setNote(noteOfWord(word));
    // The effect runs once for this screen; the ref above guards a second run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startConnect = async () => {
    if (starting) return;
    setStarting(true);
    setNote(null);
    try {
      const { url } = await api.call('google.connectStart', {});
      // The server makes the address. The page still leaves for Google only.
      if (!isGoogleAddress(url)) throw new Error('not a Google address');
      leave(url);
    } catch (error) {
      setNote({ kind: 'error', error });
      setStarting(false);
    }
  };

  const data = status.data;
  const state = data?.state;
  const noteText = note === null ? null : note.kind === 'denied' ? t('gcal.denied') : note.kind === 'failed' ? t('gcal.failed')
    : note.kind === 'old' ? t('errors.reasons.google_link_old') : note.kind === 'not_ready' ? t('gcal.notReady')
      : note.kind === 'error' ? errorMessage(note.error, t) : null;
  const done = note?.kind === 'done' && note.meetings > 0 ? t('gcal.done', { count: note.meetings }) : null;
  const connected = state === 'ok' || state === 'not_synced';

  return (
    <Section title={t('gcal.title')}>
      <LoadFailed query={status} />
      {data && !data.ready && <p className="text-body text-label-2">{t('gcal.notReady')}</p>}
      {data?.ready && state === 'none' && (
        <>
          <p className="text-subheadline text-ink-2">{t('gcal.intro')}</p>
          <p className="text-footnote text-ink-2">{t('gcal.onlyThree')}</p>
        </>
      )}
      {connected && <p role="status" className="text-body text-ink">{done ?? t('gcal.connected')}</p>}
      {state === 'not_synced' && <p className="text-footnote text-ink-2">{t('gcal.notSynced')}</p>}
      {state === 'broken' && <p className="text-body text-ink">{t('gcal.broken')}</p>}
      <FormError text={noteText} />
      {data?.ready && (state === 'none' || state === 'broken') && (
        <div>
          <Button variant="primary" disabled={starting || connect.isPending} onClick={() => void startConnect()}>
            {state === 'broken' ? t('gcal.connectAgain') : t('gcal.connect')}
          </Button>
        </div>
      )}
      {connected && (
        <div>
          <Button disabled={disconnect.isPending} onClick={() => setAsking(true)}>{t('gcal.disconnect')}</Button>
        </div>
      )}
      {asking && (
        <Sheet
          open
          onOpenChange={(open) => { if (!open) setAsking(false); }}
          title={t('gcal.disconnectTitle')}
          footer={(
            <>
              {/* A double press must not disconnect. Keep takes the focus, and the disconnect goes to the start side, away from the pointer. */}
              <Button variant="destructive" className="me-auto" onClick={() => { setAsking(false); disconnect.mutate({}); }}>{t('gcal.disconnect')}</Button>
              <Button autoFocus data-autofocus onClick={() => setAsking(false)}>{t('gcal.keep')}</Button>
            </>
          )}
        >
          <p className="pt-1 text-body text-ink">{t('gcal.disconnectBody')}</p>
        </Sheet>
      )}
    </Section>
  );
}
