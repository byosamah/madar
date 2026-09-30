import { Fragment } from 'react';
import { segmentsOf } from '../lib/text';

/** A post or a description. It keeps its own text direction (spec 10.8) and shows mentions as names. */
export function RichText({ body, className = '' }: { body: string; className?: string }) {
  return (
    <p dir="auto" className={`whitespace-pre-line break-words ${className}`}>
      {segmentsOf(body).map((segment, i) =>
        segment.kind === 'text'
          ? <Fragment key={i}>{segment.text}</Fragment>
          : <span key={i} className="font-semibold text-accent">@{segment.name}</span>)}
    </p>
  );
}
