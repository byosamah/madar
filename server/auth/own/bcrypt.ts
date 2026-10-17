import bcrypt from 'bcryptjs';

/**
 * The copied password of Supabase Auth (owner decision 4; spec section 4): the switch copies the bcrypt hashes (cost 10), so
 * nobody sets a new password. The first sign-in checks the bcrypt hash once (77 to 95 ms of CPU in the office object, wave 0) and
 * stores a PBKDF2 hash in its place (verifyPassword gives upgrade: true). bcryptjs imports the module "crypto", so the Worker
 * config needs nodejs_compat (it has it), and no Supabase entry may load this file (server/workerGraph.test.ts).
 * Until a person signs in once, a wrong password costs about 90 ms against 35 ms for an unknown email: a small sign that the email
 * has a copied row. It ends with the first sign-in of that person.
 */

const BCRYPT = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function isBcryptHash(stored: string): boolean {
  return BCRYPT.test(stored);
}

export function verifyBcrypt(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}
