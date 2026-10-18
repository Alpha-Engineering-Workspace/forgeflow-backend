export class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
    this.code = code;
  }
}
export const invalidCredentials = () => new AuthError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
export const invalidSession = () => new AuthError(401, 'INVALID_SESSION', 'Session is invalid or expired');
