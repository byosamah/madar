/** The one line under a form after a failed step. A screen reader reads it at once. */
export function FormError({ text }: { text: string | null }) {
  if (!text) return null;
  return <p role="alert" className="text-footnote text-late">{text}</p>;
}
