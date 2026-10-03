import { jobsApp } from '../jobs/app';
import { startApps, type AppMount } from './apps';
import type { Started } from './start';

/** The job app at /jobs (plan 5.5). */
export const jobsMount: AppMount = { name: 'jobs', app: (deps) => jobsApp(deps) };

export const startJobs = (): Started => startApps([jobsMount]);
