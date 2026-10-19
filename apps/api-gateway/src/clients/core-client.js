// Explicit allowlist: never pass arbitrary paths or query strings to Core.
const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const resource = new RegExp(`^/(${UUID})(/members)?$`);

export function workspaceCorePath(method, path) {
  if (path === '/' && ['POST', 'GET'].includes(method)) return '/internal/workspaces';
  const match = resource.exec(path);
  if (!match) return null;
  if (match[2]) return method === 'GET' ? `/internal/workspaces/${match[1]}/members` : null;
  return ['GET', 'PATCH'].includes(method) ? `/internal/workspaces/${match[1]}` : null;
}

export function createCoreProxy({ coreUrl, coreInternalKey, fetchImpl = fetch }) {
  if (!coreInternalKey || coreInternalKey.length < 32) throw new Error('CORE_INTERNAL_KEY must be >=32 characters');
  const base = new URL(coreUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.pathname !== '/' || base.search || base.hash || base.username || base.password) {
    throw new Error('Invalid CORE_SERVICE_URL');
  }
  return async (req, res) => {
    const path = workspaceCorePath(req.method, req.path);
    if (!path) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' }, requestId: req.requestId });
    const url = new URL(path, base);
    if (req.method === 'GET' && req.path === '/') {
      // Preserve validated pagination only. Do not forward arbitrary query fields.
      if (Object.keys(req.query).some((key) => !['page', 'limit'].includes(key))) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid pagination' }, requestId: req.requestId });
      }
      for (const key of ['page', 'limit']) {
        if (req.query[key] !== undefined) {
          if (typeof req.query[key] !== 'string' || !/^\d{1,4}$/.test(req.query[key])) {
            return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid pagination' }, requestId: req.requestId });
          }
          url.searchParams.set(key, req.query[key]);
        }
      }
    } else if (Object.keys(req.query).length) {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Unexpected query parameters' }, requestId: req.requestId });
    }
    let upstream;
    try {
      upstream = await fetchImpl(url, {
        method: req.method,
        headers: {
          'content-type': 'application/json',
          'x-forgeflow-internal-key': coreInternalKey,
          'x-forgeflow-user-id': req.userId,
        },
        ...(['POST', 'PATCH'].includes(req.method) ? { body: JSON.stringify(req.body ?? {}) } : {}),
        signal: AbortSignal.timeout(5000),
      });
    } catch (error) {
      const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
      return res.status(timeout ? 504 : 502).json({ error: { code: timeout ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', message: 'Workspace service unavailable' }, requestId: req.requestId });
    }
    let payload;
    try { payload = await upstream.json(); } catch {
      return res.status(502).json({ error: { code: 'UPSTREAM_INVALID', message: 'Workspace service unavailable' }, requestId: req.requestId });
    }
    if (!payload || typeof payload !== 'object' || (!upstream.ok && !payload.error?.code)) {
      return res.status(502).json({ error: { code: 'UPSTREAM_INVALID', message: 'Workspace service unavailable' }, requestId: req.requestId });
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(upstream.status).json(payload);
  };
}
