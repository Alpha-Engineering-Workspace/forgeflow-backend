import { isIP } from 'node:net';
import { createHash } from 'node:crypto';

function keyHash(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
}

const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

function peerIp(req) {
  // Gateway does not trust X-Forwarded-For. Only a verified BFF can supply this.
  const submitted = req.get('x-forgeflow-client-ip');
  if (submitted && submitted.length <= 64 && isIP(submitted)) return submitted;
  return req.socket.remoteAddress || 'unknown';
}

export function createAuthLimiter(redis) {
  return async function authLimiter(req, res, next) {
    const ip = keyHash(peerIp(req));
    const email = typeof req.body?.email === 'string' ? keyHash(req.body.email.trim().toLowerCase()) : 'missing';
    const resetToken = typeof req.body?.token === 'string' ? keyHash(req.body.token) : 'missing';
    let policies;
    if (req.path === '/register') {
      policies = [[`ff:register:ip:${ip}`, 10, 3600000], [`ff:register:pair:${ip}:${email}`, 3, 3600000]];
    } else if (req.path === '/email/resend') {
      policies = [[`ff:verify-resend:ip:${ip}`, 20, 3600000], [`ff:verify-resend:pair:${ip}:${email}`, 3, 3600000]];
    } else if (req.path === '/email/verify') {
      policies = [[`ff:verify-token:ip:${ip}`, 30, 900000]];
    } else if (req.path === '/login') {
      policies = [[`ff:login:ip:${ip}`, 30, 900000], [`ff:login:pair:${ip}:${email}`, 5, 900000]];
    } else if (req.path === '/password/forgot' || req.path === '/password/reset') {
      policies = [[`ff:reset:ip:${ip}`, 20, 3600000], [`ff:reset:pair:${ip}:${req.path === '/password/reset' ? resetToken : email}`, 3, 3600000]];
    } else {
      return next();
    }
    try {
      for (const [key, max, windowMs] of policies) {
        const result = await redis.eval(INCREMENT_SCRIPT, { keys: [key], arguments: [String(windowMs)] });
        const [count, ttl] = result.map(Number);
        if (count > max) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil(ttl / 1000))));
          return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' }, requestId: req.requestId });
        }
      }
      return next();
    } catch {
      return res.status(503).json({ error: { code: 'LIMITER_UNAVAILABLE', message: 'Service temporarily unavailable' }, requestId: req.requestId });
    }
  };
}
