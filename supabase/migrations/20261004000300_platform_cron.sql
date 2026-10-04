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
-- The secret goes only over https. Plain http is for the local stack only: a host of one label (kong), host.docker.internal
-- or a private IPv4 address. Any other http address fails the run and sends nothing. scripts/deploy/secrets.ts must also
-- refuse such a project_url before it writes it.
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
  -- /{2} stands for the two slashes, so this file holds no address (suite 10 checks it).
  if project_url !~* '^https:/{2}'
    and project_url !~* '^http:/{2}([a-z0-9-]+|host\.docker\.internal|(10|127)(\.[0-9]{1,3}){3}|192\.168(\.[0-9]{1,3}){2}|172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2})(:[0-9]+)?(/|$)'
  then
    raise exception 'madar-jobs: project_url must use https (plain http only inside the local Docker network).';
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

-- pg_cron keeps one row in cron.job_run_details for each run, with the whole command, and never deletes it. At 96 runs a day
-- that is about 32 MB a year in the 500 MB free database. Every night at 03:00 (UTC) this job deletes the rows older than 7 days.
select cron.schedule(
  'madar-cron-history',
  '0 3 * * *',
  $history$delete from cron.job_run_details where end_time < now() - interval '7 days'$history$
);
