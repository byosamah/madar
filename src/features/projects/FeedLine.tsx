import { useTranslation } from 'react-i18next';
import type { FeedItem } from '../../api/contract/views';
import { Age } from '../../components/Age';
import { AgentLabel } from '../../components/AgentLabel';
import { Avatar } from '../../components/Avatar';
import { feedText } from './feed';

/** One latest update on a card: the avatar, one line of text and the age (spec 4.1). */
export function FeedLine({ item }: { item: FeedItem }) {
  const { t } = useTranslation();
  return (
    <li className="flex min-w-0 items-center gap-2">
      <Avatar user={item.author} size={20} />
      <p className="min-w-0 flex-1 truncate text-footnote">
        <bdi className="font-semibold">{item.author.name.split(' ')[0]}</bdi>{' '}
        {item.author.kind === 'agent' && <><AgentLabel />{' '}</>}
        <bdi className="text-label-2">{feedText(item, t)}</bdi>
      </p>
      <span className="shrink-0 text-caption text-label-2"><Age stamp={item.at} /></span>
    </li>
  );
}
