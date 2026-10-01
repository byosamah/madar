/** Tiny class-join. It replaces the `cn` helper of the lucide-animated source files. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
