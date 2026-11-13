import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../server/config.js';
import { jobConfigSchema, newJob } from '../shared/jobs.js';
import { defaultWeights, scoringConfiguration } from '../shared/scoring.js';
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

test('normalizes every toggle combination to 100 percent and excludes inactive eligibility', () => {
  const expectations = [
    [true, true, { requiredSkills: 4000, preferredSkills: 2000, experience: 1500, cgpa: 1000, projects: 1500 }],
    [false, true, { requiredSkills: 4706, preferredSkills: 2353, cgpa: 1176, projects: 1765 }],
    [true, false, { requiredSkills: 4444, preferredSkills: 2222, experience: 1667, projects: 1667 }],
    [false, false, { requiredSkills: 5333, preferredSkills: 2667, projects: 2000 }]
  ];
  for (const [experience, cgpa, expected] of expectations) {
    const result = scoringConfiguration({
      experienceCriteria: { enabled: experience, minimumYears: 12 },
      cgpaCriteria: { enabled: cgpa, minimumCGPA: 9 }
    });
    assert.deepEqual(result.basisPoints, expected);
    assert.equal(Object.values(result.basisPoints).reduce((total, points) => total + points, 0), 10000);
    assert.equal(Object.hasOwn(result.eligibilityCriteria, 'experience'), experience);
    assert.equal(Object.hasOwn(result.eligibilityCriteria, 'cgpa'), cgpa);
  }
  assert.equal(defaultWeights.experience, 15);
});

test('validates job details, skill uniqueness, referral counts and CGPA scales', () => {
  const job = { ...newJob(), title: 'Engineer', description: 'Build tooling.' };
  assert.equal(jobConfigSchema.parse(job).referralCount, 3);
  for (const patch of [
    { title: '   ' }, { description: '' }, { deadline: '2027-02-30' },
    { referralCount: 0 }, { referralCount: 101 }, { referralCount: 1.5 },
    { requiredSkills: [{ name: 'TypeScript' }], preferredSkills: [{ name: ' typescript ' }] },
    { experienceCriteria: { enabled: true, minimumYears: 4, maximumYears: 2 } },
    { experienceCriteria: { enabled: true, minimumYears: 2, experienceTypes: [] } },
    { cgpaCriteria: { enabled: true, scale: '4', minimumCGPA: 4.1 } },
    { cgpaCriteria: { enabled: true, scale: '10', minimumCGPA: 8, maximumCGPA: 7 } },
    { cgpaCriteria: { enabled: true, scale: 'percentage', minimumCGPA: 101 } }
  ]) assert.equal(jobConfigSchema.safeParse({ ...job, ...patch }).success, false, JSON.stringify(patch));
  const off = jobConfigSchema.parse({ ...job, experienceCriteria: { enabled: false, minimumYears: 4 },
    cgpaCriteria: { enabled: false, scale: '4', minimumCGPA: 3.7 } });
  assert.equal(off.experienceCriteria.minimumYears, 4);
  assert.equal(off.cgpaCriteria.minimumCGPA, 3.7);
});
