import { appendFile } from 'node:fs/promises';

// Disposable local development inbox. Files stay OUTSIDE the git repository.
// Integrate a real email provider/queue in Phase 12.
export function createResetSender(environment = process.env) {
  const path = environment.AUTH_RESET_OUTBOX_FILE;
  if (environment.NODE_ENV === 'production') {
    // No fake success: recoverability needs a real outbound provider in production.
    return async () => { throw new Error('Production reset transport is not configured'); };
  }
  if (!path) {
    return async () => { throw new Error('Set AUTH_RESET_OUTBOX_FILE to an external ignored file path'); };
  }
  return async ({ email, token }) => {
    await appendFile(path, JSON.stringify({ email, token, createdAt: new Date().toISOString() }) + '\n', {
      mode: 0o600, flag: 'a',
    });
  };
}
