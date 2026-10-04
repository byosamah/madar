-- The change signals that realtime.send did not send (plan 5.8; task M1; proof.md, Z0a item 5). The Realtime sender reports
-- each one to the usage meter, and the meter adds them to the row of the month with the next request. usage.get shows the
-- Admin one line while the last one is less than a day old, so a missing grant does not fail without a sign.
-- Not a platform file: the db-mode harness and the it suites apply it, as they apply usage_month.

alter table usage_month
  add column signals_failed bigint not null default 0,
  add column signals_failed_at timestamptz;
