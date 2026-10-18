import { AuthError } from './auth.errors.js';
import { bearerToken } from '../../../../../shared/auth-security.js';
import { registerSchema, loginSchema, refreshSchema, forgotSchema, resetSchema, verifyEmailSchema, resendEmailSchema } from './auth.schema.js';

function validate(schema, body) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AuthError(400, 'VALIDATION_ERROR', 'Invalid request fields');
  return parsed.data;
}
export function createAuthController(service) {
  return {
    register: async (req, res) => res.status(201).json({ user: await service.register(validate(registerSchema, req.body)) }),
    login: async (req, res) => res.json(await service.login(validate(loginSchema, req.body))),
    refresh: async (req, res) => res.json(await service.refresh(validate(refreshSchema, req.body))),
    logout: async (req, res) => {
      await service.logout(validate(refreshSchema, req.body));
      res.status(204).end();
    },
    me: async (req, res) => {
      const token = bearerToken(req.headers.authorization);
      if (!token) throw new AuthError(401, 'UNAUTHORIZED', 'Authentication required');
      res.json({ user: await service.currentUser(token) });
    },
    verifyEmail: async (req, res) => {
      await service.verifyEmail(validate(verifyEmailSchema, req.body));
      res.status(204).end();
    },
    resendEmail: async (req, res) => {
      await service.resendEmail(validate(resendEmailSchema, req.body));
      res.status(202).json({ message: 'If this address is pending verification, a new link will be sent.' });
    },
    forgot: async (req, res) => {
      await service.forgotPassword(validate(forgotSchema, req.body));
      res.status(202).json({ message: 'If that address is registered, recovery instructions will be sent.' });
    },
    reset: async (req, res) => {
      await service.resetPassword(validate(resetSchema, req.body));
      res.status(204).end();
    },
  };
}
