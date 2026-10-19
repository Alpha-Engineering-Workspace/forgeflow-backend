// Core owns invitations and can use the existing Resend account via a private runtime secret.
// No invitation token appears in HTTP JSON responses or logs.
export function createInvitationMailer(env = process.env, fetchImpl = fetch) {
  const ready = () => env.WORKSPACE_INVITE_EMAIL_MODE === 'resend' &&
    Boolean(env.WORKSPACE_INVITE_RESEND_API_KEY && env.WORKSPACE_INVITE_EMAIL_FROM && env.WORKSPACE_INVITE_BASE_URL);
  return {
    ready,
    async send({ email, token, workspaceName }) {
      if (!ready()) throw new Error('Invitation delivery not configured');
      const base = new URL(env.WORKSPACE_INVITE_BASE_URL);
      if (base.protocol !== 'https:' && !(base.protocol === 'http:' && base.hostname === 'localhost')) {
        throw new Error('Invalid invitation base URL');
      }
      const url = new URL('/invite', base);
      // Fragment is never transmitted to the web server on initial GET or via Referrer.
      url.hash = new URLSearchParams({ token }).toString();
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(5000),
        headers: { authorization: `Bearer ${env.WORKSPACE_INVITE_RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.WORKSPACE_INVITE_EMAIL_FROM, to: [email],
          subject: 'You are invited to a ForgeFlow workspace',
          text: `You have been invited to join ${workspaceName} on ForgeFlow. Open this link, sign in with the invited email, and confirm acceptance: ${url.toString()}\n\nThis link expires in 7 days.` }),
      });
      if (!response.ok) throw new Error('Invitation email provider rejected request');
    },
  };
}
