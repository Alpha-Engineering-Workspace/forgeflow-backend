const routes = new Map([
  ['POST /register', '/register'],
  ['POST /login', '/login'],
  ['POST /refresh', '/refresh'],
  ['POST /logout', '/logout'],
  ['GET /me', '/me'],
  ['POST /password/forgot', '/password/forgot'],
  ['POST /password/reset', '/password/reset'],
]);

export function createAuthProxy({ authUrl, internalKey, fetchImpl = fetch }) {
  if (!internalKey || internalKey.length < 32) throw new Error('AUTH_INTERNAL_KEY must be >=32 characters');
  const base = new URL(authUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('Invalid AUTH_SERVICE_URL');
  }
  return async (req, res) => {
    const path = routes.get(`${req.method} ${req.path}`);
    if (!path) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' }, requestId: req.requestId });
    let response;
    try {
      response = await fetchImpl(new URL(`/internal/auth${path}`, base), {
        method: req.method,
        headers: {
          'content-type': 'application/json',
          'x-forgeflow-internal-key': internalKey,
          ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
        },
        ...(req.method === 'POST' ? { body: JSON.stringify(req.body ?? {}) } : {}),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
      return res.status(timeout ? 504 : 502).json({ error: { code: timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', message: 'Authentication service unavailable' }, requestId: req.requestId });
    }
    if (response.status === 204) return res.status(204).end();
    // Never render raw upstream text/HTML or forward arbitrary headers.
    let data;
    try { data = await response.json(); } catch { return res.status(502).json({ error: { code: 'UPSTREAM_INVALID', message: 'Authentication service unavailable' }, requestId: req.requestId }); }
    if (!response.ok && (!data?.error?.code || !data.error.message)) {
      return res.status(502).json({ error: { code: 'UPSTREAM_INVALID', message: 'Authentication service unavailable' }, requestId: req.requestId });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(response.status).json(data);
  };
}
