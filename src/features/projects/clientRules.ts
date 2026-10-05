import { z } from 'zod';
import type { Client } from '../../api/contract/entities';
import { clientName } from '../../lib/clientName';
import type { Lang } from '../../lib/dates';
import { INITIALS_PATTERN } from '../../lib/projectCode';

/** What the client form holds. "same" says the contact person is the client (colleague comment 10). */
export type ClientDraft = { name: string; nameAr: string; initials: string; contactName: string; same: boolean; phone: string; email: string };

/** Each value is a text key, so the form shows the message in the screen language. */
export type ClientErrors = Partial<Record<'name' | 'initials' | 'email', string>>;

export function emptyClientDraft(): ClientDraft {
  return { name: '', nameAr: '', initials: '', contactName: '', same: false, phone: '', email: '' };
}

export function draftOfClient(client: Client): ClientDraft {
  return {
    name: client.name, nameAr: client.nameAr ?? '', initials: client.initials ?? '', contactName: client.contactName, same: false,
    phone: client.phone, email: client.email,
  };
}

const Email = z.email();

/**
 * The rules of the client form (owner, 2026-10-05, item 1): an English or an Arabic name, initials of 3 or 4 capital letters,
 * and a valid email when there is one. An old client without initials may keep none ("initialsOptional"), because the record
 * allows it; once given, initials follow the rule.
 */
export function validateClientDraft(draft: ClientDraft, options: { initialsOptional?: boolean } = {}): ClientErrors {
  const errors: ClientErrors = {};
  if (!draft.name.trim() && !draft.nameAr.trim()) errors.name = 'clientForm.errors.name';
  const initials = draft.initials.trim();
  if (!(options.initialsOptional && initials === '') && !INITIALS_PATTERN.test(initials)) errors.initials = 'clientForm.errors.initials';
  const email = draft.email.trim();
  if (email && !Email.safeParse(email).success) errors.email = 'clientForm.errors.email';
  return errors;
}

/** The input of clients.create. The contact is the client's name in the screen language when "Same as the client" is on. */
export function clientInput(draft: ClientDraft, lang: Lang) {
  const name = draft.name.trim();
  const nameAr = draft.nameAr.trim();
  const initials = draft.initials.trim();
  return {
    name, nameAr, ...(initials ? { initials } : {}),
    contactName: draft.same ? clientName({ name, nameAr }, lang) : draft.contactName.trim(),
    phone: draft.phone.trim(), email: draft.email.trim(),
  };
}

/** The patch of clients.update: only the fields that changed. */
export function clientPatch(client: Client, draft: ClientDraft, lang: Lang): Partial<ReturnType<typeof clientInput>> {
  const next = clientInput(draft, lang);
  const before: Record<string, string> = {
    name: client.name, nameAr: client.nameAr ?? '', contactName: client.contactName, phone: client.phone, email: client.email, initials: client.initials ?? '',
  };
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => before[key] !== value));
}

/** Another client with these initials: a warning, never a block (owner, 2026-10-05). */
export function otherWithInitials(initials: string, clients: Client[], selfId: string | null): Client | undefined {
  const wanted = initials.trim();
  if (!wanted) return undefined;
  return clients.find((client) => client.id !== selfId && client.initials === wanted);
}
