import { appendFile } from 'node:fs/promises';

// Local file delivery is DEV-ONLY; production sends via a verified Resend sender domain.
export function createVerificationSender(env = process.env, fetchImpl = fetch) {
  let verifyUrl;
  try {
    const origin = new URL(env.AUTH_VERIFY_BASE_URL);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash ||
      (env.NODE_ENV === 'production' && origin.protocol !== 'https:')) throw new Error('bad URL');
    verifyUrl = new URL('/verify-email', origin);
  } catch {
    const unavailable = async () => { throw new Error('Invalid AUTH_VERIFY_BASE_URL'); };
    unavailable.configured = false;
    return unavailable;
  }
  const mode = env.AUTH_EMAIL_MODE ?? (env.NODE_ENV === 'production' ? 'resend' : 'file');
  let send;
  if (mode === 'file' && env.NODE_ENV !== 'production' && env.AUTH_VERIFICATION_OUTBOX_FILE) {
    send = async ({ email, token }) => {
      const link = new URL(verifyUrl);
      link.searchParams.set('token', token);
      await appendFile(env.AUTH_VERIFICATION_OUTBOX_FILE,
        JSON.stringify({ email, url: link.toString(), createdAt: new Date().toISOString() }) + '\n',
        { mode: 0o600, flag: 'a' });
    };
  } else if (mode === 'resend' && env.RESEND_API_KEY && env.AUTH_EMAIL_FROM) {
    send = async ({ email, token }) => {
      const link = new URL(verifyUrl);
      link.searchParams.set('token', token);
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env.AUTH_EMAIL_FROM, to: [email], subject: 'Verify your ForgeFlow email',
          text: `Verify your email within 12 hours:\n${link}\nIf you did not sign up, ignore this email.`,
        }),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error('Verification email provider rejected request');
    };
  } else {
    const unavailable = async () => { throw new Error('Email delivery not configured'); };
    unavailable.configured = false;
    return unavailable;
  }
  send.configured = true;
  return send;
}
