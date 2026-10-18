# ForgeFlow — Milestone 3 Email Verification (Backend Slice)

## Rules

- All valid email domains can sign up, including Gmail, Outlook, Yahoo and personal/company domains. **A syntactically valid address does not prove mailbox ownership.**
- Registration commits an unverified `auth.users` row and a hashed, single-use token lasting **12 hours**. Verified status is set only after a valid token is redeemed.
- Unverified users cannot login, refresh, or access `/me`. JWTs now carry signed `ev: true`; old JWTs without that claim are immediately invalid at Gateway. This deliberately invalidates older browser sessions.
- Resend expires prior verification links. Resend responds with a generic 202 for unknown/verified/pending addresses and is Redis-rate-limited. Tokens never appear in ordinary logs.
- Existing users automatically have `email_verified_at = NULL` after migration `004`. Do **not** silently mark them verified. They must use resend and confirm mailbox ownership.

## Flow and files

`Browser -> Next.js BFF (future) -> Gateway -> Auth Service -> PostgreSQL`.

`POST /api/auth/register`: 201 unverified user (no access/refresh tokens).

`POST /api/auth/email/resend`: 202 generic response; may send fresh link.

`POST /api/auth/email/verify`: 204 verified; invalid/used/expired link 400.

`POST /api/auth/login`: 403 `EMAIL_NOT_VERIFIED` for valid password of an unverified account.

Backend paths: `migrations/004_add_email_verification.js`, `apps/auth-service/src/modules/auth/`, `apps/api-gateway/src/clients/auth-client.js`, `apps/api-gateway/src/middleware/auth-limits.js`, `shared/auth-security.js`, `tests/`.

## Delivery

Development only (`.env` ignored by Git):

```dotenv
AUTH_VERIFY_BASE_URL=http://localhost:3000
AUTH_EMAIL_MODE=file
AUTH_VERIFICATION_OUTBOX_FILE=.env.email-verification-outbox.jsonl
```

Production/staging uses a real transactional email provider. This implementation supports Resend HTTP API:

```dotenv
AUTH_VERIFY_BASE_URL=https://YOUR_FRONTEND_DOMAIN
AUTH_EMAIL_MODE=resend
AUTH_EMAIL_FROM="ForgeFlow <verify@YOUR_VERIFIED_SENDER_DOMAIN>"
RESEND_API_KEY=REPLACE_WITH_PRIVATE_PROVIDER_KEY
```

Configure Resend and verify the **sender** domain first. Recipients may use any legitimate mailbox provider/domain. Never put provider keys in frontend code, logs, ChatGPT messages, Git or image layers.

If no delivery config exists, registration/resend fail closed with 503. If provider fails **after** the DB transaction, the account remains unverified and can request a new link; delivery retry and transactional outbox remain future Phase 12 work. Real inbox delivery is not verified merely by passing tests or writing to the local outbox.

Docker Compose's `auth` container maps server-only provider environment variables. Compose health checks can pass without provider credentials, but registration returns 503; deployment readiness for public signup requires configured email delivery.

## Local verification and GitHub

1. On backend repo, clean merged `main`: `git switch main && git pull --ff-only` then `git switch -c feat/auth-email-verification`.
2. `git apply --check` the supplied patch before `git apply`. Stop on conflicts; do not force or overwrite unrelated work.
3. Set **development** mail variables above in the existing ignored `.env`; keep current DB/JWT/BFF credentials.
4. Start Docker PostgreSQL/Redis: `docker-compose -f compose.yml up -d postgres redis`.
5. `npm run db:migrate` applies `004`; then `npm run check` and `npm run test:integration`.
6. Start `npm run dev:auth` and `npm run dev:gateway` in two terminals, then run `node --env-file-if-exists=.env scripts/smoke-email-verification.mjs` in Git Bash (Node 24).
7. The old `scripts/smoke-auth.mjs` expects immediate login after signup and will now fail as designed; use the new smoke test.
8. Inspect `git diff`, stage only intended files, commit/push/PR, verify latest-commit CI, then squash merge. Coordinate frontend compatibility.

## Frontend follow-up — NOT included

Build `/verify-email` (explicit **Confirm** action, never mutate on a GET/link scanner), `/check-email` and `/api/backend/auth/email/{verify,resend}` BFF handlers. Protect same-origin writes, prevent tokens from being cached/logged or sent to third parties, and set `Referrer-Policy: no-referrer`. Update Register UI copy to say “Check your email; link expires in 12 hours.” Auth.js/login must not expose tokens in browser sessions.
