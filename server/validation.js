import { z } from 'zod';
import { industries } from './security.js';

const publicMail = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com',
  'icloud.com', 'live.com', 'aol.com', 'proton.me', 'protonmail.com', 'mail.com', 'gmx.com', 'yandex.com']);
export const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
export const workEmail = email.refine(value => !publicMail.has(value.split('@')[1]), 'Enter your work email address.');
export const password = z.string().min(12, 'Use at least 12 characters for your password.')
  .refine(value => Buffer.byteLength(value) <= 72, 'Password must fit within 72 UTF-8 bytes.');
export const credentials = z.object({ email, password: z.string().min(1).max(72)
  .refine(value => Buffer.byteLength(value) <= 72, 'Invalid password length.') }).strict();
export const passwords = { password, confirmPassword: z.string().max(72) };
export const matchingPasswords = { message: 'Passwords must match.', path: ['confirmPassword'] };
export const register = z.object({ name: z.string().trim().min(2).max(100), email: workEmail, ...passwords })
  .strict().refine(data => data.password === data.confirmPassword, matchingPasswords);
export const reset = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), ...passwords })
  .strict().refine(data => data.password === data.confirmPassword, matchingPasswords);
export const emailOnly = z.object({ email }).strict();
export const verify = credentials.extend({ code: z.string().regex(/^\d{6}$/, 'Enter the six-digit code.') });
export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid record ID.');
export const rawToken = z.string().regex(/^[a-f0-9]{64}$/, 'Enter a valid invitation code.');
export const httpsUrl = z.url().max(500).refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
    !parsed.port && parsed.hostname.includes('.') && !parsed.hostname.endsWith('.');
}, 'Enter a public HTTPS website URL.');
export const companyInput = z.object({
  name: z.string().trim().min(2).max(100), website: httpsUrl, industry: z.enum(industries)
}).strict();
export const directoryQuery = z.object({
  q: z.string().trim().max(100).default(''), industry: z.enum(industries).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1)
}).strict();
