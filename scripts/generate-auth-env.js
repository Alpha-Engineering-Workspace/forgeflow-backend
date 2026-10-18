import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

// One-time local helper. Never print secrets to terminal or commit this file's output.
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const lines = [
  `AUTH_JWT_PUBLIC_KEY_B64=${Buffer.from(publicKey).toString('base64')}`,
  `AUTH_JWT_PRIVATE_KEY_B64=${Buffer.from(privateKey).toString('base64')}`,
  `AUTH_INTERNAL_KEY=${randomBytes(32).toString('hex')}`,
  `GATEWAY_BFF_KEY=${randomBytes(32).toString('hex')}`,
];
await writeFile('.env.auth.generated', lines.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.log('Created ignored .env.auth.generated. Copy values securely into your existing .env; do not commit either file.');
