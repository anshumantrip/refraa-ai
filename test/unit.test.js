import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { companies } from '../server/catalog.js';
import { allows, companyKey, cookiePolicy, csrfValid, digest, otp, otpOutcome, OTP_ATTEMPTS,
  selectableRole, token, websiteHost } from '../server/security.js';

test('generates six numeric digits and distinct opaque tokens', () => {
  for (let index = 0; index < 50; index++) assert.match(otp(), /^\d{6}$/);
  assert.match(token(), /^[a-f0-9]{64}$/);
  assert.notEqual(token(), token());
});

test('OTP rejects missing, expired and exhausted challenges', () => {
  const hash = digest(token(), 'otp', '012345');
  const challenge = { hash, expiresAt: 200, attempts: 0 };
  assert.equal(otpOutcome(challenge, hash, 199), 'verified');
  assert.equal(otpOutcome(challenge, token(), 199), 'incorrect');
  assert.equal(otpOutcome(challenge, hash, 200), 'closed');
  assert.equal(otpOutcome({ ...challenge, attempts: OTP_ATTEMPTS }, hash, 100), 'closed');
  assert.equal(otpOutcome(undefined, hash, 100), 'closed');
});

test('CSRF requires the exact origin, matching cookie and valid signature', () => {
  const config = { origin: 'https://refraa.example', secret: token() };
  const nonce = token();
  const signed = nonce + '.' + digest(config.secret, 'csrf', nonce);
  assert.ok(csrfValid(config, signed, signed, config.origin));
  assert.equal(csrfValid(config, signed, signed, 'https://other.example'), false);
  assert.equal(csrfValid(config, signed, token(), config.origin), false);
  const tampered = nonce + '.' + token();
  assert.equal(csrfValid(config, tampered, tampered, config.origin), false);
  assert.equal(cookiePolicy(config).secure, true);
  assert.equal(cookiePolicy(config).httpOnly, true);
  assert.equal(cookiePolicy(config).prefix, '__Host-');
});

test('role selection requires a prior grant', () => {
  assert.equal(selectableRole('employee', 'recruiter'), false);
  assert.equal(selectableRole('employee', 'company_admin'), false);
  assert.equal(selectableRole('recruiter', 'super_admin'), false);
  assert.equal(selectableRole('recruiter', 'employee'), true);
  assert.equal(selectableRole('recruiter', 'recruiter'), true);
  assert.equal(allows('recruiter', 'company_admin'), false);
});

test('seed has 100 distinct names and official website hosts across four industries', () => {
  assert.equal(companies.length, 100);
  assert.equal(new Set(companies.map(entry => companyKey(entry.name))).size, 100);
  assert.equal(new Set(companies.map(entry => websiteHost(entry.website))).size, 100);
  assert.equal(new Set(companies.map(entry => entry.industry)).size, 4);
  assert.ok(companies.every(entry => entry.website.startsWith('https://')));
});

test('production config requires HTTPS, a database and a strong-length secret', () => {
  const env = { NODE_ENV: 'production', AUTH_SECRET: randomBytes(32).toString('hex'),
    MONGODB_URI: 'mongodb://localhost/refraa_test', APP_ORIGIN: 'https://refraa.example' };
  assert.equal(loadConfig(env).production, true);
  assert.throws(() => loadConfig({ ...env, APP_ORIGIN: 'http://refraa.example' }), /HTTPS/);
  assert.throws(() => loadConfig({ ...env, AUTH_SECRET: '' }), /AUTH_SECRET/);
  assert.throws(() => loadConfig({ ...env, MONGODB_URI: '' }), /MONGODB_URI/);
});
