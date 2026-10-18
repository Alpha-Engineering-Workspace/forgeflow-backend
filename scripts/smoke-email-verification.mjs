// Development only: local ignored verification outbox required.
// Do not print any password, link, token, or secret.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const key = process.env.GATEWAY_BFF_KEY;
const outbox = process.env.AUTH_VERIFICATION_OUTBOX_FILE;
if (!key || !outbox || process.env.NODE_ENV === 'production') {
  throw new Error('Configure local .env with GATEWAY_BFF_KEY and development verification outbox');
}
const email = `verify-smoke-${randomUUID()}@example.test`;
const password = 'A-strong-smoke-password-123';
async function call(path, data) {
  const res = await fetch(`http://127.0.0.1:3001/api/auth${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forgeflow-bff-key': key },
    body: JSON.stringify(data), signal: AbortSignal.timeout(6000),
  });
  return { status: res.status, data: res.status === 204 ? null : await res.json() };
}
function check(name, result, status) {
  if (result.status !== status) throw new Error(`${name}: expected ${status}, got ${result.status}`);
  console.log(`PASS ${name}: ${status}`);
}
check('register', await call('/register', { name: 'Smoke User', email, password }), 201);
check('unverified login blocked', await call('/login', { email, password }), 403);
const emails = (await readFile(outbox, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
const mail = emails.reverse().find((entry) => entry.email === email);
if (!mail) throw new Error('No verification mail in local outbox');
const token = new URL(mail.url).searchParams.get('token');
if (!token) throw new Error('Missing verification token');
check('verify', await call('/email/verify', { token }), 204);
check('replay rejected', await call('/email/verify', { token }), 400);
const login = await call('/login', { email, password });
check('verified login', login, 200);
if (!login.data?.accessToken || !login.data?.refreshToken) throw new Error('Missing server-side authentication tokens');
console.log('Email verification smoke passed');
