import { useTranslation } from 'react-i18next';
import { useTypers } from '../../app/live/typing';
import { usePersonName } from '../../app/personName';
import { useCall } from '../../app/runtime';
import { actorContext } from '../../lib/grammar';

/** The first name, as the chat list shows it (a row names the author by the first name). */
const firstName = (name: string) => name.split(' ')[0];

/** Three small dots that fade one after the other. Only motion-safe classes move them, so Reduce motion keeps them still. */
function Dots() {
  return (
    <span aria-hidden className="inline-flex items-center gap-[3px]">
      {[0, 200, 400].map((delay) => (
        <i
          key={delay}
          data-typing-dot
          aria-hidden
          style={{ animationDelay: `${delay}ms` }}
          className="block size-[5px] rounded-full bg-ink-2 motion-safe:animate-pulse"
        />
      ))}
    </span>
  );
}

/**
 * The line above the message box of a chat (chat presence design B2): "Reem is typing...", "Reem and Faisal are typing...", "Several
 * people are typing..." (3 or more). It is always one row high, so the messages never jump when the line comes and goes. The signal
 * expires 8 seconds after the last one (useTypers), so a lost stop never leaves the line on. The names come from the office list.
 */
export function TypingLine({ conversationId }: { conversationId: string }) {
  const { t } = useTranslation();
  const nameOf = usePersonName();
  const typers = useTypers(conversationId);
  const users = useCall('users.list', {}, { enabled: typers.length > 0 });
  const people = typers.flatMap((id) => users.data?.find((user) => user.id === id) ?? []);
  let text = '';
  if (typers.length >= 3) text = t('chat.typingMany');
  else if (people.length === typers.length && people.length === 2) text = t('chat.typingTwo', { a: firstName(nameOf(people[0])), b: firstName(nameOf(people[1])) });
  else if (people.length === typers.length && people.length === 1) text = t('chat.typingOne', { name: firstName(nameOf(people[0])), context: actorContext(people[0]) });
  return (
    <div data-testid="typing-line" aria-live="polite" className="flex h-6 shrink-0 items-center gap-2 px-3 text-footnote text-ink-2 sm:px-5">
      {text !== '' && (
        <>
          <Dots />
          <span className="min-w-0 truncate">{text}</span>
        </>
      )}
    </div>
  );
}
