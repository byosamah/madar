import { Fragment } from 'react';
import { Link } from 'react-router';
import { PRIVATE } from '../app/privateMark';
import { segmentsOf } from '../lib/text';

/** True when the address is outside Madar. An address that does not parse counts as outside. */
function isOutside(url: string): boolean {
  try {
    return new URL(url).origin !== window.location.origin;
  } catch {
    return true;
  }
}

/**
 * A web address in a message (chat design 2026-10-19, item 7). It keeps its own direction (an address inside Arabic text still reads
 * left to right) and wraps anywhere, so a long address never widens the bubble. An outside address opens in a new tab; a Madar address
 * opens in the same tab.
 */
function WebAddress({ url }: { url: string }) {
  const outside = isOutside(url);
  return (
    <a
      href={url}
      dir="ltr"
      className="break-all text-link underline underline-offset-2"
      {...(outside ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {url}
    </a>
  );
}

/**
 * A post or a comment. It keeps its own text direction (spec 10.8), shows mentions as names and project codes as links. With `everyone`
 * (the message or the comment named people by @everyone), the words @everyone, @all and @الجميع look like a mention (fbk_041).
 */
export function RichText({ body, className = '', everyone = false }: { body: string; className?: string; everyone?: boolean }) {
  return (
    <p dir="auto" className={`${PRIVATE} whitespace-pre-line break-words ${className}`}>
      {segmentsOf(body, { everyone }).map((segment, i) => {
        if (segment.kind === 'text') return <Fragment key={i}>{segment.text}</Fragment>;
        if (segment.kind === 'everyone') return <span key={i} className="font-semibold text-link">{segment.word}</span>;
        if (segment.kind === 'url') return <WebAddress key={i} url={segment.url} />;
        if (segment.kind === 'mention') return <span key={i} className="font-semibold text-link">@{segment.name}</span>;
        return <Link key={i} to={`/projects/code/${segment.code}`} className="font-semibold text-link underline-offset-2 hover:underline">#{segment.code}</Link>;
      })}
    </p>
  );
}
