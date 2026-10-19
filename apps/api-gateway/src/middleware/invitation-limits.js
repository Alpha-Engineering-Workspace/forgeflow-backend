// Shared Redis quota across Gateway replicas. Never trust X-Forwarded-* client values.
// The user ID is derived from the verified access JWT in the caller middleware.
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const creation = new RegExp(`^/(${UUID})/invitations(?:/(${UUID})/resend)?$`);

export function createInvitationLimiter(redis) {
  return async (req, res, next) => {
    if (req.method !== 'POST') return next();
    const match = creation.exec(req.path);
    const accept = req.path === '/invitations/accept';
    if (!match && !accept) return next();
    if (!redis?.multi) return res.status(503).json({ error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Invitation service temporarily unavailable' } });
    const key = accept ? `ff:limit:invite:accept:${req.userId}` : `ff:limit:invite:send:${match[1]}:${req.userId}`;
    const cap = accept ? 30 : 12;
    try {
      // MULTI/EXEC prevents per-replica bypass and increments with expiry atomically.
      const result = await redis.multi().incr(key).expire(key, 3600, 'NX').exec();
      const attempts = Number(result?.[0]);
      if (!Number.isSafeInteger(attempts)) throw new Error('Invalid Redis limiter reply');
      if (attempts > cap) {
        res.setHeader('Retry-After', '3600');
        return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many invitation requests' } });
      }
      return next();
    } catch {
      return res.status(503).json({ error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Invitation service temporarily unavailable' } });
    }
  };
}
