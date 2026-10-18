import { describe, it, expect, vi } from 'vitest';
import { createVerificationSender } from '../apps/auth-service/src/modules/auth/verification-mail.js';

describe('verification mail', () => {
  it('sends to custom recipient domains via configured provider', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const sender = createVerificationSender({ NODE_ENV: 'production', AUTH_EMAIL_MODE: 'resend',
      AUTH_VERIFY_BASE_URL: 'https://forgeflow.example',
      AUTH_EMAIL_FROM: 'ForgeFlow <verify@sender.example>', RESEND_API_KEY: 'test-key' }, fetchImpl);
    expect(sender.configured).toBe(true);
    await sender({ email: 'me@personal-domain.example', token: 'opaque-token' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).to).toEqual(['me@personal-domain.example']);
  });
  it('refuses production file transport and insecure verification links', () => {
    expect(createVerificationSender({ NODE_ENV: 'production', AUTH_EMAIL_MODE: 'file',
      AUTH_VERIFICATION_OUTBOX_FILE: '/tmp/mail', AUTH_VERIFY_BASE_URL: 'https://forgeflow.example' }).configured).toBe(false);
    expect(createVerificationSender({ NODE_ENV: 'production', AUTH_EMAIL_MODE: 'resend',
      RESEND_API_KEY: 'key', AUTH_EMAIL_FROM: 'foo@bar.example', AUTH_VERIFY_BASE_URL: 'http://forgeflow.example' }).configured).toBe(false);
  });
});
