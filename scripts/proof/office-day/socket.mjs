// A live socket through the Pages forwarder and the service binding (exit wave 5, R8 (d)): sign in, ask live.ticket, open
// wss://<page host>/api/live?ticket=..., send ping, wait for pong. Node 22 has WebSocket. It prints the steps, never a token.
// Run: set -a; . secrets/test-accounts.env; set +a; node scripts/proof/office-day/socket.mjs https://preview.madar-46r.pages.dev
const [base] = process.argv.slice(2);
const password = process.env.MADAR_TEST_PASSWORD_MEMBER;
if (!base || !password) {
  console.error('Use: node socket.mjs <page address>, with MADAR_TEST_PASSWORD_MEMBER in the environment.');
  process.exit(2);
}
const signin = await fetch(`${base}/api/auth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'password', email: 'member@madar.test', password }) });
if (!signin.ok) throw new Error(`The sign-in answered ${signin.status}.`);
const { access_token: token } = await signin.json();
const batch = await fetch(`${base}/api/batch`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-madar-build': '9999.1.1' }, body: JSON.stringify({ v: 1, calls: [{ i: 0, name: 'live.ticket', input: {} }] }) });
// The answer of a batch: results[i].output (server/http/batch.ts).
const ticket = (await batch.json()).results?.[0]?.output?.ticket;
if (!ticket) throw new Error(`No live ticket: the batch answered ${batch.status}.`);
const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/api/live?ticket=${ticket}`);
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('no pong in 10 s'), 10_000);
  ws.addEventListener('open', () => ws.send('ping'));
  ws.addEventListener('message', (event) => {
    if (event.data === 'pong') {
      clearTimeout(timer);
      resolve('pong');
    }
  });
  ws.addEventListener('error', () => resolve('the socket failed to open'));
});
ws.close();
console.log(JSON.stringify({ socket: result }));
process.exit(result === 'pong' ? 0 : 1);
