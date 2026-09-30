import { Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FeedItem } from '../../../api/contract/views';
import { Age } from '../../../components/Age';
import { AgentLabel } from '../../../components/AgentLabel';
import { Avatar } from '../../../components/Avatar';
import { RichText } from '../../../components/RichText';
import { feedText } from '../../projects/feed';

/** A post as a card, or a system event as one quiet line (spec 5.2). */
export function FeedEntry({ item, fileNames }: { item: FeedItem; fileNames: Map<string, string> }) {
  const { t } = useTranslation();
  if (item.kind === 'event') {
    return (
      <li className="flex items-center gap-3 px-1">
        <Avatar user={item.author} size={28} />
        <p className="min-w-0 flex-1 text-subheadline">
          <bdi className="font-semibold">{item.author.name}</bdi>{' '}
          {item.author.kind === 'agent' && <><AgentLabel />{' '}</>}
          <span className="text-label-2">{feedText(item, t)}</span>
        </p>
        <span className="text-caption text-label-2"><Age stamp={item.at} /></span>
      </li>
    );
  }
  return (
    <li className="surface flex flex-col gap-2 rounded-card p-4">
      <div className="flex items-center gap-3">
        <Avatar user={item.author} size={36} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <bdi className="truncate font-semibold">{item.author.name}</bdi>
            {item.author.kind === 'agent' && <AgentLabel />}
          </p>
          <p className="text-caption text-label-2">
            <Age stamp={item.at} />
            {item.editedAt && <> · {t('overview.edited')}</>}
          </p>
        </div>
      </div>
      <RichText body={item.body} className="text-body" />
      {item.fileIds.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {item.fileIds.map((id) => (
            <li key={id} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-footnote">
              <Paperclip size={14} aria-hidden />
              <bdi>{fileNames.get(id) ?? id}</bdi>
            </li>
          ))}
        </ul>
      )}
      {item.commentCount > 0 && <p className="text-footnote text-label-2">{t('overview.comments', { n: item.commentCount })}</p>}
    </li>
  );
}
