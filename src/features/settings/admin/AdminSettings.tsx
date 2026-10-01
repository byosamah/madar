import { OfficeSection } from './OfficeSection';
import { PeopleSection } from './PeopleSection';

/** The Admin parts of Settings (spec 9). The API refuses them for everyone else too. */
export function AdminSettings() {
  return (
    <>
      <PeopleSection />
      <OfficeSection />
    </>
  );
}
