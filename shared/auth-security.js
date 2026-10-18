import { createHash, randomBytes, randomUUID, timingSafeEqual, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export function opaqueToken() {
  return randomBytes(32).toString('base64url');
}
export function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
export function fixedTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function decodeKey(encoded, kind) {
  if (typeof encoded !== 'string' || !encoded) throw new Error(`Missing ${kind} JWT key`);
  const pem = Buffer.from(encoded, 'base64').toString('utf8');
  return kind === 'private' ? createPrivateKey(pem) : createPublicKey(pem);
}

export function makeJwtConfig(environment = process.env, requirePrivate = false) {
  const issuer = environment.AUTH_JWT_ISSUER || 'forgeflow-auth';
  const audience = environment.AUTH_JWT_AUDIENCE || 'forgeflow-api';
  const publicKey = decodeKey(environment.AUTH_JWT_PUBLIC_KEY_B64, 'public');
  const privateKey = requirePrivate ? decodeKey(environment.AUTH_JWT_PRIVATE_KEY_B64, 'private') : null;
  if (publicKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyDetails?.modulusLength < 2048) {
    throw new Error('JWT public key must be RSA >=2048 bits');
  }
  if (requirePrivate && (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails?.modulusLength < 2048)) {
    throw new Error('JWT private key must be RSA >=2048 bits');
  }
  return { issuer, audience, publicKey, privateKey };
}

// RSA JWT implementation deliberately accepts ONLY RS256 (no alg=none or algorithm negotiation).
// Signing secrets stay in Auth; Gateway gets only the public key.
export function issueAccessToken(userId, config, now = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: userId, iss: config.issuer, aud: config.audience,
    iat: now, nbf: now, exp: now + 600, jti: randomUUID(),
  })).toString('base64url');
  const content = `${header}.${payload}`;
  const signature = sign('RSA-SHA256', Buffer.from(content), config.privateKey).toString('base64url');
  return `${content}.${signature}`;
}

export function verifyAccessToken(token, config, now = Math.floor(Date.now() / 1000)) {
  if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('Invalid JWT');
  }
  const [h, p, s] = token.split('.');
  let header;
  let body;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    body = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid JWT');
  }
  if (header.alg !== 'RS256' || header.typ !== 'JWT' ||
      !verify('RSA-SHA256', Buffer.from(`${h}.${p}`), config.publicKey, Buffer.from(s, 'base64url')) ||
      body.iss !== config.issuer || body.aud !== config.audience ||
      typeof body.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.sub) ||
      !Number.isInteger(body.exp) || !Number.isInteger(body.iat) || !Number.isInteger(body.nbf) ||
      body.exp <= now || body.nbf > now + 30 || body.iat > now + 30 ||
      body.exp - body.iat > 600 || body.iat > body.exp || typeof body.jti !== 'string') {
    throw new Error('Invalid JWT');
  }
  return { userId: body.sub, expiresAt: body.exp };
}

export function bearerToken(header) {
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header || '');
  return match?.[1] ?? null;
}
