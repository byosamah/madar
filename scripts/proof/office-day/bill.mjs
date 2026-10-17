// The bill of a batch with mail on the office path (exit wave 5, R8 (a); wave 3 design choice 1). It signs in as the member with
// the own sign-in, sends N batches of comments.create (each one a notice and its mail), and prints the minute window for the
// GraphQL query of day.graphql. Run: set -a; . secrets/test-accounts.env; set +a; node scripts/proof/office-day/bill.mjs
// https://preview.madar-46r.pages.dev 20 tsk_001. It never prints the password or a token.
const [base, count = '20', task = 'tsk_001'] = process.argv.slice(2);
const password = process.env.MADAR_TEST_PASSWORD_MEMBER;
if (!base || !password) {
  console.error('Use: node bill.mjs <page address> [count] [task id], with MADAR_TEST_PASSWORD_MEMBER in the environment.');
  process.exit(2);
}
const signin = await fetch(`${base}/api/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'password', email: 'member@madar.test', password }) });
if (!signin.ok) throw new Error(`The sign-in answered ${signin.status}.`);
const { access_token: token } = await signin.json();
const from = new Date();
for (let i = 0; i < Number(count); i += 1) {
  const answer = await fetch(`${base}/api/batch`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-madar-build': '9999.1.1' },
    body: JSON.stringify({ v: 1, calls: [{ i: 0, name: 'comments.create', input: { targetType: 'task', targetId: task, body: `Bill probe ${i + 1} of ${count}` } }] }),
  });
  if (!answer.ok) throw new Error(`Batch ${i + 1} answered ${answer.status}.`);
  const [entry] = (await answer.json()).results ?? [];
  if (!entry?.ok) throw new Error(`Batch ${i + 1} gave no comment: ${entry?.error?.code ?? 'no result'}.`);
}
const to = new Date(Date.now() + 60_000);
console.log(JSON.stringify({ batches: Number(count), from: from.toISOString(), to: to.toISOString() }));
