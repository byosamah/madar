import { Fragment } from 'react';
import { Link } from 'react-router';
import { segmentsOf } from '../lib/text';

/** A post or a comment. It keeps its own text direction (spec 10.8), shows mentions as names and project codes as links. */
export function RichText({ body, className = '' }: { body: string; className?: string }) {
  return (
    <p dir="auto" className={`whitespace-pre-line break-words ${className}`}>
      {segmentsOf(body).map((segment, i) => {
        if (segment.kind === 'text') return <Fragment key={i}>{segment.text}</Fragment>;
        if (segment.kind === 'mention') return <span key={i} className="font-semibold text-link">@{segment.name}</span>;
        return <Link key={i} to={`/projects/code/${segment.code}`} className="font-semibold text-link underline-offset-2 hover:underline">#{segment.code}</Link>;
      })}
    </p>
  );
}
