import { createStore, get, set } from 'idb-keyval';
import { z } from 'zod';
import { EnterpriseView } from './contract/platform';
import { VADO_ENTERPRISE } from './vadoEnterprise';

/**
 * The fake directory of the prototype (Madar enterprises, design 5.19): the list of the fake companies, so the prototype of the companies can show
 * two of them. There is no platform part in the prototype (design 12, D12), so nothing writes this directory but a test. The state of a company
 * lives in its own store (persist.ts). This file is pure: it has no screen code and no state of an office.
 */

/** The second fake enterprise. Its people have neutral names (src/data/sampleSecondEnterprise.ts uses the same emails). */
export const SECOND_ENTERPRISE = 'ent_002';
export const SECOND_ENTERPRISE_EMAILS = ['layla.hassan@oasis.test', 'nadia.farouk@oasis.test', 'karim.younis@oasis.test'];

/** The sample people of VADOs' Companies in the prototype: the email rule of src/data/seed.ts (sampleEmail), applied to the ten names. */
const VADO_NAMES = [
  'Hala Nasser', 'Faisal Al-Harbi', 'Reem Al-Ghamdi', 'Omar Haddad', 'Sara Al-Qahtani', 'Yousef Saleh', 'Lina Mansour', 'Khalid Al-Mutairi',
  'Turki Al-Otaibi', 'Noura Al-Shammari',
];
const emailOf = (name: string): string => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@madar.test`;

/** One enterprise of the fake directory: the row of platform.enterprises.list plus the emails that the directory reserves for it. */
export const FakeEnterprise = EnterpriseView.extend({ emails: z.array(z.string()) });
export type FakeEnterprise = z.infer<typeof FakeEnterprise>;

export const FakeDirectory = z.object({
  enterprises: z.array(FakeEnterprise),
});
export type FakeDirectory = z.infer<typeof FakeDirectory>;

/** The two companies of the prototype. */
export function defaultDirectory(today: string): FakeDirectory {
  const created = `${today}T09:00:00.000+03:00`;
  return {
    enterprises: [
      {
        id: VADO_ENTERPRISE, address: 'vados', name: "VADOs' Companies", nameAr: 'شركات فادو', logo: null, state: 'active',
        limits: { people: null, storageBytes: null }, people: 10, invited: 0, storageBytes: 61_000_000, lastWriteAt: created, createdAt: created,
        firstAdmin: null, hasOwner: false, emails: [...VADO_NAMES.map(emailOf), 'assistant@madar.test'],
      },
      {
        id: SECOND_ENTERPRISE, address: 'oasis', name: 'Oasis Builders', nameAr: 'واحة للإنشاءات', logo: null, state: 'active',
        limits: { people: 15, storageBytes: 1_073_741_824 }, people: 3, invited: 0, storageBytes: 2_400_000, lastWriteAt: created, createdAt: created,
        firstAdmin: { name: 'Layla Hassan', email: SECOND_ENTERPRISE_EMAILS[0] }, hasOwner: false, emails: [...SECOND_ENTERPRISE_EMAILS],
      },
    ],
  };
}

export type DirectoryHandle = { read(): FakeDirectory; write(directory: FakeDirectory): Promise<void> };

const KEY = 'directory';

/** A handle on a directory held in memory. A test uses it, and the browser uses it when IndexedDB fails. */
export function memoryDirectory(start: FakeDirectory): DirectoryHandle {
  let current = structuredClone(start);
  return {
    read: () => current,
    async write(directory) {
      current = structuredClone(directory);
    },
  };
}

/** The directory in IndexedDB under the key `directory`. A missing or broken record starts the default. IndexedDB that fails gives memory. */
export async function openDirectory(today: string, dbName = 'madar-directory'): Promise<DirectoryHandle> {
  try {
    if (typeof indexedDB === 'undefined' || indexedDB === null) throw new Error('IndexedDB is not available.');
    const store = createStore(dbName, 'data');
    const saved = FakeDirectory.safeParse(await get(KEY, store));
    let current: FakeDirectory = saved.success ? saved.data : defaultDirectory(today);
    if (!saved.success) await set(KEY, current, store);
    return {
      read: () => current,
      async write(directory) {
        current = structuredClone(directory);
        await set(KEY, current, store);
      },
    };
  } catch {
    return memoryDirectory(defaultDirectory(today));
  }
}
