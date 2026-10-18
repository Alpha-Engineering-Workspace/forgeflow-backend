import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(72).refine(
  (value) => Buffer.byteLength(value, 'utf8') <= 72,
  { message: 'Password exceeds bcrypt 72-byte limit' }
);
const token = z.string().min(30).max(200);

export const registerSchema = z.strictObject({ name: z.string().trim().min(1).max(120), email, password });
export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(200) });
export const refreshSchema = z.strictObject({ refreshToken: token });
export const forgotSchema = z.strictObject({ email });
export const resetSchema = z.strictObject({ token, password });
