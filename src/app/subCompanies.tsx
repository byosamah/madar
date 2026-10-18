import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { SubCompany } from '../api/contract/entities';
import { useCall } from './runtime';

/** The sub-companies of the office by id. Empty outside the app frame (tests of one part, the sign-in screens). */
export const SubCompaniesContext = createContext<ReadonlyMap<string, SubCompany>>(new Map());

/**
 * The sub-companies of the office with their logos (fbk_007). A project shows the logo and the name of its sub-company, so this
 * reads subCompanies.list once (the same pattern as app/pictures.tsx) and gives each lookup its sub-company.
 */
export function SubCompaniesProvider({ children }: { children: ReactNode }) {
  const list = useCall('subCompanies.list', {});
  const byId = useMemo(() => new Map((list.data ?? []).map((sub) => [sub.id, sub] as const)), [list.data]);
  return <SubCompaniesContext.Provider value={byId}>{children}</SubCompaniesContext.Provider>;
}

/** One sub-company of the office by its id, or undefined when it has none or the id is empty. */
export function useSubCompany(id: string | null | undefined): SubCompany | undefined {
  return useContext(SubCompaniesContext).get(id ?? '');
}
