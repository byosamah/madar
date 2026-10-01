import { Navigate, useSearchParams } from 'react-router';
import { HomeScreen } from './HomeScreen';

const OLD_PROJECTS_KEYS = ['filter', 'stage', 'status', 'health', 'sort', 'view'];

/** Links saved before the redesign opened the Projects list at "/" with values. They still open it (redesign spec 3.1). */
export function HomeOrRedirect() {
  const [params] = useSearchParams();
  if (OLD_PROJECTS_KEYS.some((key) => params.has(key))) return <Navigate replace to={`/projects?${params.toString()}`} />;
  return <HomeScreen />;
}
