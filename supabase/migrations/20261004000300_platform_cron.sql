-- The schedule of the 15-minute job (plan 5.5; task N3.2). The test harness skips *_platform_*.sql files: this one needs the
-- Supabase extensions pg_cron, pg_net and Vault.
--
-- Every 15 minutes pg_cron posts to <project_url>/functions/v1/jobs/run through pg_net, with two headers:
--   x-region: eu-central-1, so the jobs function runs in Frankfurt (plan, change 5);
--   x-madar-jobs-secret, which the function compares with its JOBS_SECRET in constant time (server/jobs/app.ts).
-- This file holds no secret and no environment address (plan 6.1, rule 4). The command reads both from the Vault secrets
-- project_url and jobs_secret, by name, each time it runs. scripts/deploy/secrets.ts writes their values per project, and a
-- restore into another project must write them again (platform facts 5.3).
--
-- While a secret is missing, the run fails with a plain message in cron.job_run_details and sends nothing.
-- pg_net sends the request after the run commits and keeps the answer in net._http_response for 6 hours. It waits up to
-- 2 minutes, under the 150 s wall clock of a function on the free plan. The job decides by Riyadh time what to do, so the
-- schedule stays simple (platform facts 5.2).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- cron.schedule with a name that exists changes that job, so a second run of this file keeps one job.
select cron.schedule(
  'madar-jobs',
  '*/15 * * * *',
  $job$
do $run$
declare
  project_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url');
  jobs_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'jobs_secret');
begin
  if coalesce(project_url, '') = '' or coalesce(jobs_secret, '') = '' then
    raise exception 'madar-jobs: the Vault secrets project_url and jobs_secret must both exist (scripts/deploy/secrets.ts).';
  end if;
  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/jobs/run',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-region', 'eu-central-1',
      'x-madar-jobs-secret', jobs_secret
    ),
    timeout_milliseconds := 120000
  );
end
$run$;
$job$
);
