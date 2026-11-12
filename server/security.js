import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const OTP_TTL = 10 * 60_000;
export const OTP_ATTEMPTS = 5;
export const RESEND_MS = 45_000;
export const SESSION_TTL = 7 * 24 * 60 * 60_000;
export const RESET_TTL = 30 * 60_000;
export const roles = ['super_admin', 'company_admin', 'recruiter', 'employee'];
export const selectableRoles = ['recruiter', 'employee'];
export const industries = ['Technology', 'Finance', 'Consulting', 'E-commerce'];

export const token = () => randomBytes(32).toString('hex');
export const otp = () => String(randomInt(1_000_000)).padStart(6, '0');
export const digest = (secret, purpose, value) =>
  createHmac('sha256', secret).update(purpose + '\0' + value).digest('hex');

export function equal(left, right) {
  return typeof left === 'string' && typeof right === 'string' &&
    Buffer.byteLength(left) === Buffer.byteLength(right) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function cookies(header = '') {
  const values = Object.create(null);
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=');
    if (index > 0) values[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return values;
}

export function cookiePolicy(config) {
  const secure = config.origin.startsWith('https:');
  return { secure, prefix: secure ? '__Host-' : '', sameSite: 'lax', path: '/', httpOnly: true };
}

export function csrfValid(config, cookie, header, origin) {
  if (origin !== config.origin || !equal(cookie, header) || !/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(header)) return false;
  const [nonce, signature] = header.split('.');
  return equal(signature, digest(config.secret, 'csrf', nonce));
}

export function otpOutcome(challenge, inputHash, now = Date.now()) {
  if (!challenge?.hash || challenge.expiresAt <= now || challenge.attempts >= OTP_ATTEMPTS) return 'closed';
  return equal(challenge.hash, inputHash) ? 'verified' : 'incorrect';
}

export const companyKey = (name) => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const emailDomain = (email) => email.slice(email.lastIndexOf('@') + 1);
export const websiteHost = (website) => new URL(website).hostname.toLowerCase().replace(/^www\./, '');

export function selectableRole(grantedRole, requestedRole) {
  if (!roles.includes(grantedRole) || !roles.includes(requestedRole)) return false;
  return requestedRole === grantedRole || (grantedRole === 'recruiter' && requestedRole === 'employee');
}

export function allows(role, ...permitted) {
  return roles.includes(role) && permitted.includes(role);
}
