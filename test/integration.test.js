/* global ClipboardEvent, document, DataTransfer, window */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { chromium } from 'playwright-core';
import { createApp } from '../server/app.js';
import { createMailer } from '../server/mail.js';
import { Company, Membership, Organization, User, ensureIndexes } from '../server/models.js';
import { seedCompanies } from '../server/seed.js';
import { OTP_ATTEMPTS, token } from '../server/security.js';
import { newJob } from '../shared/jobs.js';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resumeConfig } from '../server/resumes/config.js';
import { Candidate, Resume } from '../server/resumes/models.js';
import { docxFixture, fixtureLines, pdfFixture } from './resume-fixtures.js';

const mongo = process.env.TEST_MONGODB_URI;
const skip = !mongo && 'Set TEST_MONGODB_URI to run database integration checks.';
const password = 'Local test ' + token().slice(0, 16);
const newPassword = 'New test ' + token().slice(0, 16);
const messages = [];
const mailer = { requireDelivery() {}, async send(to, subject, text) { messages.push({ to, subject, text }); } };
const config = { origin: '', secret: token(), mail: {}, production: false };
let server;

async function listen(app, options) {
  const service = app.listen(0, '127.0.0.1');
  await once(service, 'listening');
  options.origin = 'http://127.0.0.1:' + service.address().port;
  return service;
}

before(async () => {
  if (!mongo) return;
  await mongoose.connect(mongo, { dbName: 'refraa_test_' + randomUUID().replaceAll('-', ''), serverSelectionTimeoutMS: 5000 });
  await ensureIndexes();
  server = await listen(createApp(config, mailer), config);
});

test('liveness and database readiness return distinct results', { skip }, async () => {
  const request = client();
  assert.equal((await request('/health')).data.status, 'ok');
  assert.equal((await request('/ready')).data.status, 'ready');
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
});

function client(options = config) {
  const jar = new Map();
  let csrf;
  return async (path, body, overrides = {}) => {
    const method = overrides.method || (body === undefined ? 'GET' : 'POST');
    if (method !== 'GET' && !csrf && overrides.csrf !== false) {
      const response = await fetch(options.origin + '/api/auth/csrf');
      csrf = (await response.json()).csrf;
      jar.set('refraa_csrf', response.headers.getSetCookie()[0].split(';')[0]);
    }
    const response = await fetch(options.origin + '/api' + path, {
      method,
      headers: {
        Cookie: [...jar.values()].join('; '),
        Origin: overrides.origin || options.origin,
        ...(body !== undefined && !(body instanceof FormData) && { 'Content-Type': 'application/json' }),
        ...(csrf && overrides.csrf !== false && { 'X-CSRF-Token': csrf })
      },
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body)
    });
    for (const cookie of response.headers.getSetCookie()) jar.set(cookie.split('=')[0], cookie.split(';')[0]);
    const data = response.status === 204 ? null : response.headers.get('content-type')?.includes('json')
      ? await response.json() : Buffer.from(await response.arrayBuffer());
    return { status: response.status, data, headers: response.headers };
  };
}

const latest = (email, pattern) => messages.findLast(item => item.to === email && pattern.test(item.subject))?.text;
const codeFor = email => latest(email, /Verify/).match(/\b\d{6}\b/)[0];
const register = (request, email) => request('/auth/register', { name: 'Test Account', email, password, confirmPassword: password });
const verify = (request, email, code, secret = password) => request('/auth/verify', { email, code, password: secret });
const login = (request, email, secret = password) => request('/auth/login', { email, password: secret });
const wrongCode = code => code === '000000' ? '000001' : '000000';

async function signedIn(email) {
  const request = client();
  assert.equal((await register(request, email)).status, 201);
  assert.equal((await verify(request, email, codeFor(email))).status, 200);
  assert.equal((await login(request, email)).status, 200);
  return request;
}

async function activate(name, domains) {
  const company = await Company.findOneAndUpdate({ name }, { $set: { status: 'verified' } }, { returnDocument: 'after' });
  const org = await Organization.create({ company: company.id, domains });
  return { company, org };
}

test('registration, OTP controls, login, CSRF, persistent session, reset and logout', { skip }, async () => {
  const request = client();
  const email = 'account@phase-one.example';
  assert.equal((await request('/companies')).status, 401);
  assert.equal((await request('/auth/register', {}, { csrf: false })).status, 403);
  assert.equal((await register(request, email)).status, 201);
  assert.equal((await register(request, email.toUpperCase())).status, 409);
  assert.equal((await login(request, email)).data.code, 'EMAIL_UNVERIFIED');
  assert.equal((await request('/auth/me')).status, 401);
  const firstCode = codeFor(email);
  const stored = await User.findOne({ email }).select('+verification +password');
  assert.notEqual(stored.verification.hash, firstCode);
  assert.match(stored.password, /^\$2/);
  assert.equal((await request('/auth/resend', { email })).data.code, 'OTP_COOLDOWN');
  assert.equal((await verify(request, email, firstCode, 'incorrect-password')).data.code, 'OTP_INCORRECT');
  assert.equal((await verify(request, email, wrongCode(firstCode))).data.code, 'OTP_INCORRECT');
  await User.updateOne({ email }, { $set: { 'verification.expiresAt': Date.now() - 1, 'verification.nextSendAt': Date.now() - 1 } });
  assert.equal((await verify(request, email, firstCode)).data.code, 'OTP_CLOSED');
  assert.equal((await request('/auth/resend', { email })).status, 200);
  const secondCode = codeFor(email);
  await User.updateOne({ email }, { $set: { 'verification.attempts': OTP_ATTEMPTS - 1 } });
  assert.equal((await verify(request, email, wrongCode(secondCode))).data.code, 'OTP_INCORRECT');
  assert.equal((await verify(request, email, secondCode)).data.code, 'OTP_CLOSED');
  await User.updateOne({ email }, { $set: { 'verification.nextSendAt': Date.now() - 1 } });
  assert.equal((await request('/auth/resend', { email })).status, 200);
  const finalCode = codeFor(email);
  const race = await Promise.all([verify(request, email, finalCode), verify(request, email, finalCode)]);
  assert.deepEqual(race.map(result => result.status).sort(), [200, 400]);
  assert.equal((await verify(request, email, finalCode)).status, 400);
  const authenticated = await login(request, email);
  assert.equal(authenticated.status, 200);
  assert.match(authenticated.headers.getSetCookie()[0], /HttpOnly/);
  assert.match(authenticated.headers.getSetCookie()[0], /SameSite=Lax/);
  assert.equal((await request('/auth/me')).data.user.email, email);
  assert.equal((await request('/auth/logout', {}, { origin: 'https://other.example' })).status, 403);
  assert.equal((await request('/auth/forgot', { email })).status, 200);
  const resetToken = latest(email, /Reset/).match(/#token=([a-f0-9]{64})/)[1];
  const reset = { token: resetToken, password: newPassword, confirmPassword: newPassword };
  assert.equal((await request('/auth/reset', reset)).status, 200);
  assert.equal((await request('/auth/reset', reset)).status, 400);
  assert.equal((await request('/auth/me')).status, 401);
  assert.equal((await login(request, email)).status, 401);
  assert.equal((await login(request, email, newPassword)).status, 200);
  assert.equal((await request('/auth/logout', {})).status, 204);
  assert.equal((await request('/auth/me')).status, 401);
});

test('missing SMTP configuration returns a delivery error before creating an account', { skip }, async () => {
  const options = { ...config };
  const service = await listen(createApp(options, createMailer(options)), options);
  try {
    const email = 'missing-mail@phase-one.example';
    assert.equal((await register(client(options), email)).data.code, 'EMAIL_NOT_CONFIGURED');
    assert.equal(await User.countDocuments({ email }), 0);
  } finally { await new Promise(resolve => service.close(resolve)); }
});

test('directory, domain and invitation verification, administrator review and tenant isolation', { skip }, async () => {
  assert.equal((await seedCompanies()).upsertedCount, 100);
  assert.equal((await seedCompanies()).upsertedCount, 0);
  const tenantA = await activate('Apple', ['a.example']);
  const tenantB = await activate('Microsoft', ['b.example']);
  const member = await signedIn('employee@a.example');
  const administrator = await signedIn('administrator@a.example');
  const admin = await User.findOne({ email: 'administrator@a.example' });
  await Membership.create({ user: admin.id, organization: tenantA.org.id, status: 'verified',
    role: 'company_admin', grant: 'company_admin', method: 'approval' });
  const route = id => '/onboarding/organizations/' + id;
  const onboarding = id => '/onboarding/company/' + id;
  const select = (request, companyId) => request('/onboarding/company', { companyId });

  const directory = await member('/companies?q=app&industry=Technology');
  assert.equal(directory.data.items[0].name, 'Apple');
  const input = { name: 'Example Platform Company', website: 'https://example-platform.example', industry: 'Technology' };
  const created = await member('/companies', input);
  assert.equal(created.status, 201);
  assert.equal(created.data.item.status, 'pending');
  assert.equal((await administrator('/companies/' + created.data.item._id)).status, 404);
  assert.equal((await member('/companies', { ...input, website: 'https://another-platform.example' })).status, 409);

  assert.equal((await select(member, tenantA.company.id)).data.membership.status, 'pending');
  assert.equal((await member(route(tenantA.org.id) + '/dashboard')).status, 403);
  assert.equal((await member(onboarding(tenantA.org.id) + '/verify', {})).data.membership.method, 'domain');
  assert.equal((await member(route(tenantA.org.id) + '/dashboard')).status, 403);
  for (const role of ['recruiter', 'company_admin', 'super_admin']) {
    assert.equal((await member(onboarding(tenantA.org.id) + '/role', { role })).status, 403);
  }
  assert.equal((await member(onboarding(tenantA.org.id) + '/role', { role: 'employee' })).status, 200);
  assert.equal((await member(route(tenantA.org.id) + '/dashboard')).status, 200);
  assert.equal((await member(route(tenantA.org.id) + '/requests')).status, 403);
  assert.equal((await member('/onboarding/platform')).status, 403);
  assert.equal((await member(route(tenantB.org.id) + '/dashboard')).status, 403);
  assert.equal((await administrator(route(tenantB.org.id) + '/requests')).status, 403);
  const otherRequest = await select(member, tenantB.company.id);
  assert.equal((await member(onboarding(tenantB.org.id) + '/verify', {})).data.membership.status, 'pending');
  assert.equal((await administrator(route(tenantA.org.id) + '/requests/' + otherRequest.data.membership.id, { decision: 'approve' })).status, 404);

  const invited = await signedIn('candidate@external.example');
  await select(invited, tenantA.company.id);
  assert.equal((await administrator(route(tenantA.org.id) + '/invitations', {
    email: 'candidate@external.example', role: 'recruiter'
  })).status, 201);
  const invitation = latest('candidate@external.example', /invitation/).match(/[a-f0-9]{64}$/)[0];
  assert.equal((await member(onboarding(tenantB.org.id) + '/verify', { invitation })).status, 400);
  assert.equal((await invited(onboarding(tenantA.org.id) + '/verify', { invitation })).data.membership.method, 'invitation');
  assert.equal((await invited(onboarding(tenantA.org.id) + '/role', { role: 'recruiter' })).status, 200);
  assert.equal((await invited(route(tenantA.org.id) + '/requests')).status, 403);

  const approval = await signedIn('approval@external.example');
  const pending = await select(approval, tenantA.company.id);
  assert.ok((await administrator(route(tenantA.org.id) + '/requests')).data.items.some(item => item.id === pending.data.membership.id));
  assert.equal((await administrator(route(tenantA.org.id) + '/requests/' + pending.data.membership.id,
    { decision: 'approve', role: 'recruiter' })).data.membership.method, 'approval');
  assert.equal((await approval(onboarding(tenantA.org.id) + '/role', { role: 'recruiter' })).status, 200);
  await User.updateOne({ _id: admin.id }, { $set: { systemRole: 'super_admin' } });
  assert.equal((await administrator('/onboarding/platform')).status, 200);
  assert.equal((await administrator(route(tenantB.org.id) + '/dashboard')).status, 403);
});

test('browser completes onboarding with OTP paste, authorized role and persistent session', {
  skip: skip || (!process.env.BROWSER_CHANNEL && !process.env.BROWSER_EXECUTABLE && 'Set BROWSER_CHANNEL or BROWSER_EXECUTABLE.'),
  timeout: 60_000
}, async () => {
  assert.ok(existsSync('dist/index.html'), 'Run npm run build before browser integration.');
  await seedCompanies();
  await activate('Adobe', ['browser.example']);
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || undefined, executablePath: process.env.BROWSER_EXECUTABLE || undefined
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8_000);
    const email = 'person@browser.example';
    await page.goto(config.origin + '/register');
    await page.getByLabel('Full name').fill('Browser User');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    const first = page.getByRole('textbox', { name: 'Digit 1' });
    await first.waitFor();
    assert.ok(await first.evaluate(input => input === document.activeElement));
    await first.press('1');
    await page.getByRole('textbox', { name: 'Digit 2' }).press('Backspace');
    assert.equal(await first.inputValue(), '');
    const code = codeFor(email);
    await first.evaluate((input, value) => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', value);
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    }, code);
    assert.equal(await page.locator('[data-otp-input]').evaluateAll(inputs => inputs.map(input => input.value).join('')), code);
    await page.getByLabel('Account password').fill(password);
    await page.getByRole('button', { name: 'Verify email' }).click();
    await page.getByRole('heading', { name: 'Sign in to refraaAI' }).waitFor();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByLabel('Company name').fill('Adobe');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.getByRole('link', { name: /Adobe Technology/ }).click();
    await page.getByRole('button', { name: 'Select this company' }).click();
    await page.getByRole('button', { name: 'Check verification' }).click();
    assert.ok(await page.getByRole('radio', { name: /Recruiter/ }).isDisabled());
    await page.getByRole('button', { name: 'Finish onboarding' }).click();
    await page.getByRole('link', { name: 'Open dashboard' }).click();
    await page.getByRole('heading', { name: 'Adobe' }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Adobe' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('heading', { name: 'Sign in to refraaAI' }).waitFor();
  } finally { await browser.close(); }
});

async function recruitingAccount(email, org, role) {
  const request = await signedIn(email);
  const user = await User.findOne({ email });
  await Membership.create({ user: user.id, organization: org.id, status: 'verified',
    role, grant: role, method: 'approval' });
  return request;
}

test('job lifecycle, criteria persistence, dashboard counts and tenant-scoped permissions', { skip }, async () => {
  await seedCompanies();
  const { org } = await activate('Oracle', []);
  const { org: other } = await activate('Cisco', []);
  const recruiter = await recruitingAccount('jobs@recruiting.example', org, 'recruiter');
  const admin = await recruitingAccount('jobs-admin@recruiting.example', org, 'company_admin');
  const employee = await recruitingAccount('jobs-employee@recruiting.example', org, 'employee');
  const outsider = await recruitingAccount('jobs-outsider@recruiting.example', other, 'recruiter');
  const root = id => '/organizations/' + id;
  const jobs = root(org.id) + '/jobs';
  const stats = root(org.id) + '/recruiting-dashboard';
  const otherJobs = root(other.id) + '/jobs';
  const getStats = async () => (await recruiter(stats)).data;
  const base = { ...newJob(), title: 'Platform Engineer [Cloud]', description: 'Build the platform.', department: 'Engineering',
    requiredSkills: [{ name: 'Node.js', evidence: 'Service ownership' }], preferredSkills: [{ name: 'Docker' }],
    experienceCriteria: { enabled: true, minimumYears: 2, maximumYears: 7, experienceTypes: ['Full-time'], includeFreshers: true, relevantOnly: true },
    cgpaCriteria: { enabled: true, scale: '4', minimumCGPA: 3.1, maximumCGPA: 4, educationLevel: 'Undergraduate', allowUnavailable: true },
    additionalCriteria: [{ type: 'Relevant projects', priority: 'Mandatory', description: 'Public API project' }] };
  const create = (request, path, configuration, publish = false) => request(path, { configuration, publish });
  const update = (request, path, configuration, revision, publish = false) =>
    request(path, { configuration, revision, publish }, { method: 'PUT' });

  assert.equal((await client()(jobs)).status, 401);
  assert.equal((await employee(jobs)).status, 403);
  assert.equal((await employee(stats)).status, 403);
  assert.equal((await outsider(stats)).status, 403);
  assert.equal((await create(outsider, jobs, base)).status, 403);
  assert.equal((await create(employee, jobs, base)).status, 403);
  assert.deepEqual((await getStats()).metrics, {
    resumesUploaded: 0, candidatesProcessed: 0, shortlistedCandidates: 0,
    pendingApprovals: 0, completedReferrals: 0, activeJobs: 0
  });
  for (const patch of [{ title: '' }, { description: '' }, { referralCount: 0 }, { referralCount: 2.5 },
    { preferredSkills: [{ name: ' node.JS ' }] }, { cgpaCriteria: { enabled: true, scale: '4', minimumCGPA: 5 } }]) {
    assert.equal((await create(recruiter, jobs, { ...base, ...patch })).status, 400);
  }
  const draft = await create(recruiter, jobs, base);
  assert.equal(draft.status, 201);
  assert.equal(draft.data.item.status, 'draft');
  assert.equal(draft.data.item.referralCount, 3);
  const id = draft.data.item._id;
  const path = jobs + '/' + id;
  assert.equal((await outsider(otherJobs + '/' + id)).status, 404);
  assert.equal((await update(outsider, otherJobs + '/' + id, base, 0)).status, 404);
  assert.equal((await outsider(otherJobs + '/' + id + '/archive', { revision: 0 })).status, 404);
  assert.equal((await admin(path)).data.item.requiredSkills[0].evidence, 'Service ownership');
  assert.equal((await recruiter(jobs + '?q=%5BCloud%5D&status=draft&department=engineering')).data.total, 1);
  assert.equal((await recruiter(jobs + '?department=Finance')).data.total, 0);
  assert.equal((await getStats()).metrics.activeJobs, 0);
  assert.equal((await getStats()).activity[0].kind, 'drafted');

  assert.equal((await create(outsider, otherJobs, { ...base, title: 'Other tenant' }, true)).status, 201);
  const disabled = { ...base, experienceCriteria: { enabled: false }, cgpaCriteria: { enabled: false }, referralCount: 5 };
  const publish = await update(admin, path, disabled, 0, true);
  assert.equal(publish.status, 200, JSON.stringify(publish.data));
  assert.equal(publish.data.item.status, 'published');
  assert.equal(publish.data.item.referralCount, 5);
  const readBack = (await recruiter(path)).data.item;
  assert.equal(readBack.experienceCriteria.enabled, false);
  assert.equal(readBack.experienceCriteria.minimumYears, 2);
  assert.equal(readBack.experienceCriteria.relevantOnly, true);
  assert.equal(readBack.cgpaCriteria.enabled, false);
  assert.equal(readBack.cgpaCriteria.minimumCGPA, 3.1);
  assert.equal(readBack.cgpaCriteria.scale, '4');
  assert.deepEqual(readBack.scoring.eligibilityCriteria, {});
  assert.deepEqual(readBack.scoring.basisPoints, { requiredSkills: 5333, preferredSkills: 2667, projects: 2000 });
  assert.equal((await update(recruiter, path, base, 0)).data.code, 'JOB_CONFLICT');

  const reenabled = await update(recruiter, path, { ...disabled, experienceCriteria: { enabled: true } }, 1);
  assert.equal(reenabled.status, 200);
  assert.equal(reenabled.data.item.experienceCriteria.minimumYears, 2);
  assert.equal(reenabled.data.item.scoring.eligibilityCriteria.experience.maximumYears, 7);
  assert.equal(reenabled.data.item.scoring.basisPoints.cgpa, undefined);
  const fixtures = [
    ['resumes', [{ batch: new mongoose.Types.ObjectId(), slot: 0, parsingStatus: 'parsed' }], 1],
    ['candidates', [{ status: 'processed' }, { status: 'shortlisted' }], 2],
    ['referrals', [{ status: 'pending_approval' }, { status: 'completed' }], 2]
  ];
  for (const [collection, rows, foreignCount] of fixtures) {
    await mongoose.connection.collection(collection).insertMany([
      ...rows.map(row => ({ organization: org._id, ...row })),
      ...Array.from({ length: foreignCount }, () => ({ organization: other._id, ...rows[0] }))
    ]);
  }
  const dashboard = await getStats();
  assert.deepEqual(dashboard.metrics, { resumesUploaded: 1, candidatesProcessed: 2, shortlistedCandidates: 1,
    pendingApprovals: 1, completedReferrals: 1, activeJobs: 1 });
  assert.deepEqual(dashboard.recentJobs.map(job => job._id), [id]);
  assert.ok(dashboard.activity.some(entry => entry.kind === 'published'));
  assert.ok(dashboard.activity.every(entry => entry._id === id));
  assert.equal((await recruiter(jobs + '?page=2')).data.items.length, 0);
  assert.equal((await employee(path + '/archive', { revision: 2 })).status, 403);
  assert.equal((await recruiter(path + '/archive', { revision: 1 })).data.code, 'JOB_CONFLICT');
  assert.equal((await recruiter(path + '/archive', { revision: 2 })).data.item.status, 'archived');
  assert.equal((await update(recruiter, path, base, 3)).data.code, 'JOB_ARCHIVED');
  assert.equal((await getStats()).metrics.activeJobs, 0);
  assert.equal((await recruiter(jobs + '?status=archived')).data.total, 1);
});

test('recruiter creates a draft, edits toggles, publishes, finds and archives a job in Chrome', {
  skip: skip || (!process.env.BROWSER_CHANNEL && !process.env.BROWSER_EXECUTABLE && 'Set BROWSER_CHANNEL or BROWSER_EXECUTABLE.'),
  timeout: 75_000
}, async () => {
  assert.ok(existsSync('dist/index.html'), 'Run npm run build before browser integration.');
  await seedCompanies();
  const { org } = await activate('Salesforce', []);
  const email = 'browser-jobs@recruiting.example';
  await recruitingAccount(email, org, 'recruiter');
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || undefined, executablePath: process.env.BROWSER_EXECUTABLE || undefined
  });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(8_000);
    const button = (name) => page.getByRole('button', { name, exact: true });
    const link = (name) => page.getByRole('link', { name, exact: true });
    const heading = name => page.getByRole('heading', { name, exact: true });
    const next = () => button('Continue').click();
    await page.goto(config.origin + '/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await button('Sign in').click();
    await heading('Welcome, Test Account').waitFor();
    assert.equal(new URL(page.url()).pathname, '/dashboard/' + org.id);
    assert.equal(await page.getByRole('navigation', { name: 'Recruiting workspace' }).getByRole('link').count(), 8);
    await link('Start New Screening').click();
    await next();
    await page.getByRole('alert').getByText('Enter a job title.').waitFor();
    await page.getByLabel('Job title (required)').fill('Browser Platform Engineer');
    await page.getByLabel('Job description (required)').fill('Maintain internal services.');
    await page.getByLabel('Department').fill('Engineering');
    await next();
    await page.getByLabel('Search or add required skills').fill('Node.js');
    await button('Add required skill').click();
    await page.getByLabel('Search or add preferred skills').fill(' node.js ');
    await button('Add preferred skill').click();
    await page.getByRole('alert').getByText('That skill is already on this job.').waitFor();
    await page.getByLabel('Search or add preferred skills').fill('React');
    await button('Add preferred skill').click();
    await next();
    await page.getByRole('switch', { name: 'Experience' }).click();
    await page.getByLabel('Minimum years').fill('2');
    await page.getByLabel('Include freshers').check();
    await next();
    await page.getByRole('switch', { name: 'CGPA' }).click();
    await page.getByLabel('CGPA scale').selectOption('4');
    await page.getByLabel('Minimum CGPA').fill('3.2');
    await next();
    await button('Add criterion').click();
    await page.getByLabel('Priority', { exact: true }).selectOption('Mandatory');
    await page.getByLabel('Criterion description').fill('A project with production users.');
    await next();
    assert.equal(await page.getByLabel('Desired candidates').inputValue(), '3');
    await page.getByLabel('Desired candidates').fill('6');
    await page.getByText('refraaAI will shortlist up to 6 suitable candidates.').waitFor();
    await next();
    await button('Save draft').click();
    await heading('Browser Platform Engineer').waitFor();
    await page.getByRole('status').getByText('Draft saved.').waitFor();
    await page.reload();
    await link('Edit job').click();
    await next();
    await next();
    assert.equal(await page.getByLabel('Minimum years').inputValue(), '2');
    await page.getByRole('switch', { name: 'Experience' }).click();
    assert.equal(await page.getByLabel('Minimum years').count(), 0);
    await next();
    assert.equal(await page.getByLabel('Minimum CGPA').inputValue(), '3.2');
    await page.getByRole('switch', { name: 'CGPA' }).click();
    assert.equal(await page.getByLabel('Minimum CGPA').count(), 0);
    await next();
    await next();
    await next();
    await page.getByText('Experience OFF', { exact: true }).waitFor();
    await page.getByText('CGPA OFF', { exact: true }).waitFor();
    await button('Publish job').click();
    await page.getByRole('status').getByText('Job published.').waitFor();
    await link('Overview').click();
    await page.getByText('Active jobs', { exact: true }).locator('..').getByText('1', { exact: true }).waitFor();
    await link('Browse jobs').click();
    await page.getByLabel('Status', { exact: true }).selectOption('published');
    await button('Filter jobs').click();
    await page.getByRole('link', { name: /Browser Platform Engineer/ }).click();
    await button('Archive job').click();
    await heading('Archive this job?').waitFor();
    await button('Confirm archive').click();
    await page.getByRole('status').getByText('Job archived.').waitFor();
    assert.equal(await link('Edit job').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  } finally { await browser.close(); }
});

const resumeInfra = resumeConfig();
const resumeSkip = skip || (!resumeInfra.bucket || !resumeInfra.redisUrl ? 'Configure test Redis and private S3 storage.' : false);

async function eventually(check, message) {
  const expires = Date.now() + 65_000;
  while (Date.now() < expires) {
    const result = await check();
    if (result) return result;
    await delay(500);
  }
  assert.fail(message);
}

test('bulk resume workflow with MongoDB, S3-compatible storage and BullMQ', { skip: resumeSkip, timeout: 210_000 }, async () => {
  await seedCompanies();
  const { org } = await activate('Intel', []);
  const { org: foreign } = await activate('AMD', []);
  const user = await recruitingAccount('resumes@fixture.example', org, 'recruiter');
  const admin = await recruitingAccount('resume-admin@fixture.example', org, 'company_admin');
  const employee = await recruitingAccount('resume-employee@fixture.example', org, 'employee');
  const outsider = await recruitingAccount('resume-outsider@fixture.example', foreign, 'recruiter');
  const base = '/organizations/' + org.id + '/resumes';
  const otherBase = '/organizations/' + foreign.id + '/resumes';
  const create = async entries => {
    const response = await user(base + '/batches', { files: entries.map(([name, bytes]) => ({ name, size: bytes.length })) });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.id;
  };
  async function send(batch, slot, entry) {
    const form = new FormData();
    form.append('file', new Blob([entry[1]]), entry[0]);
    return user(base + '/batches/' + batch + '/files/' + slot, form);
  }
  const snapshot = async batch => (await user(base + '/batches/' + batch)).data;
  const resume = id => base + '/' + id;
  const pdf = ['fixture.pdf', pdfFixture()];
  const docx = ['fixture.docx', docxFixture([...fixtureLines, 'Second version'])];
  const bad = ['broken.pdf', Buffer.from('%PDF-1.4\nbad')];
  const wrong = ['wrong.pdf', Buffer.from('not a PDF')];
  const empty = ['empty.pdf', pdfFixture([])];
  const locked = ['locked.pdf', pdfFixture([], { encrypted: true })];

  assert.equal((await client()(base)).status, 401);
  assert.equal((await employee(base)).status, 403);
  assert.equal((await outsider(base)).status, 403);
  assert.equal((await user(base + '/batches', { files: Array(1001).fill({ name: 'sample.pdf', size: 1 }) })).status, 400);

  const first = await create([pdf]);
  const accepted = await send(first, 0, pdf);
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  const id = accepted.data.id;
  assert.equal((await send(first, 0, pdf)).data.id, id);
  assert.equal((await snapshot(first)).counts.pending, 1);
  assert.equal((await user(resume(id) + '/original')).status, 404);
  assert.equal((await outsider(otherBase + '/' + id)).status, 404);
  assert.equal((await outsider(otherBase + '/batches/' + first)).status, 404);
  const multi = await create([docx, bad, empty, locked, wrong]);
  for (const [slot, entry] of [docx, bad, empty, locked, wrong].entries()) {
    assert.equal((await send(multi, slot, entry)).status, slot === 4 ? 400 : 201);
  }
  const duplicate = await create([pdf]);
  assert.equal((await send(duplicate, 0, pdf)).data.status, 'duplicate');
  assert.equal((await snapshot(duplicate)).counts.duplicates, 1);
  const cancelled = await create([pdf, docx]);
  assert.equal((await user(base + '/batches/' + cancelled + '/cancel', {})).status, 204);
  assert.equal((await send(cancelled, 0, pdf)).status, 409);
  assert.equal((await snapshot(cancelled)).counts.progress, 100);

  const workerEnv = { ...process.env, MONGODB_URI: mongo, RESUME_QUEUE_NAME: resumeInfra.queue };
  // Preserve the integration server's unique database while retaining the configured connection options.
  const mongoUrl = new URL(mongo);
  mongoUrl.pathname = '/' + mongoose.connection.name;
  workerEnv.MONGODB_URI = mongoUrl.href;
  function launch() {
    const child = spawn(process.execPath, ['server/resumes/worker.js'], { env: workerEnv, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', () => {});
    return child;
  }
  let worker;
  async function stop() {
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
    const ended = once(worker, 'exit');
    worker.kill();
    await ended;
  }
  try {
    worker = launch();
    await eventually(async () => (await snapshot(first)).counts.parsed === 1, 'First resume did not parse.');
    const batch = await eventually(async () => {
      const state = await snapshot(multi);
      return state.counts.progress === 100 && state;
    }, 'Mixed batch did not finish.');
    assert.equal(batch.counts.parsed, 1);
    assert.equal(batch.counts.failed, 4);
    assert.deepEqual(batch.files.map(row => row.parsingStatus), ['parsed', 'failed', 'ocr_required', 'failed', 'upload_failed']);
    assert.match(batch.files[3].errorDetails, /Password-protected/);
    const detail = await user(resume(id));
    assert.equal(detail.data.profile.name, 'Test Candidate');
    assert.equal(detail.data.item.extractedText, undefined);
    assert.equal(detail.data.item.storageKey, undefined);
    assert.match(detail.data.item.extractionEvidence.education[0].excerpt, /CGPA/);
    assert.deepEqual((await user(resume(id) + '/original')).data, pdf[1]);
    const second = batch.files[0]._id;
    const newer = await user(resume(second));
    const older = await user(resume(id));
    const direction = newer.data.profile.createdAt >= older.data.profile.createdAt ? [newer.data.profile, older.data.profile] : [older.data.profile, newer.data.profile];
    assert.equal((await user(resume(direction[0]._id) + '/review', { action: 'link_version', candidateId: direction[1]._id })).status, 204);
    assert.equal((await user(resume(direction[0]._id))).data.profile.versionOf, direction[1]._id);
    assert.equal(await Candidate.countDocuments({ organization: org._id }), 2);

    const failed = batch.files[1]._id;
    await stop();
    assert.equal((await user(resume(failed) + '/retry', {})).status, 200);
    assert.equal((await user(resume(failed))).data.item.parsingStatus, 'pending');
    await Resume.updateOne({ _id: failed, organization: org._id }, { $set: {
      parsingStatus: 'processing', lease: 'expired-test-lease', leaseUntil: new Date(Date.now() - 1000)
    } });
    worker = launch();
    await eventually(async () => (await user(resume(failed))).data.item.parsingStatus === 'failed', 'Restart did not pick up the durable retry.');
    assert.equal(await Candidate.countDocuments({ organization: org._id }), 2);

    assert.equal((await user(resume(id), undefined, { method: 'DELETE' })).status, 403);
    assert.equal((await admin(resume(id), undefined, { method: 'DELETE' })).status, 202);
    await eventually(async () => (await Resume.findById(id)).parsingStatus === 'deleted', 'Deletion did not finish.');
    assert.equal(await Candidate.countDocuments({ organization: org._id }), 1);

    const bulk = await create(Array(1000).fill(docx));
    let cursor = 0;
    const uploads = await Promise.all(Array.from({ length: 4 }, async () => {
      let duplicates = 0;
      while (cursor < 1000) {
        const result = await send(bulk, cursor++, docx);
        assert.equal(result.status, 201, JSON.stringify(result.data));
        if (result.data.status === 'duplicate') duplicates++;
      }
      return duplicates;
    }));
    assert.equal(uploads.reduce((sum, count) => sum + count, 0), 1000);
    const totals = (await snapshot(bulk)).counts;
    assert.equal(totals.total, 1000);
    assert.equal(totals.uploaded, 1000);
    assert.equal(totals.duplicates, 1000);
    assert.equal(totals.progress, 100);
  } finally { await stop(); }
});

test('recruiter uploads and opens a processed profile in Chrome', {
  skip: resumeSkip || (!process.env.BROWSER_CHANNEL && !process.env.BROWSER_EXECUTABLE && 'Set BROWSER_CHANNEL or BROWSER_EXECUTABLE.'),
  timeout: 90_000
}, async () => {
  await seedCompanies();
  const { org } = await activate('SAP', []);
  const email = 'browser-resume@fixture.example';
  await recruitingAccount(email, org, 'recruiter');
  const mongoUrl = new URL(mongo);
  mongoUrl.pathname = '/' + mongoose.connection.name;
  const worker = spawn(process.execPath, ['server/resumes/worker.js'], {
    env: { ...process.env, MONGODB_URI: mongoUrl.href }, stdio: ['ignore', 'ignore', 'inherit']
  });
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined,
      executablePath: process.env.BROWSER_EXECUTABLE || undefined });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(config.origin + '/login');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Resume Library', exact: true }).click();
    await page.getByRole('link', { name: 'Upload resumes', exact: true }).click();
    await page.getByLabel('Choose resumes').setInputFiles({ name: 'browser-fixture.pdf', mimeType: 'application/pdf', buffer: pdfFixture() });
    await page.getByRole('button', { name: 'Start upload' }).click();
    await page.getByRole('heading', { name: 'Upload batch' }).waitFor();
    await page.getByText('Processing completion · 100%', { exact: true }).waitFor({ timeout: 55_000 });
    await page.getByRole('link', { name: 'Open Resume Library' }).click();
    await page.getByRole('link', { name: /browser-fixture.pdf/ }).click();
    await page.getByRole('heading', { name: 'Candidate profile' }).waitFor();
    await page.getByText('Test Candidate', { exact: true }).waitFor();
    assert.ok(await page.getByRole('link', { name: 'Download original' }).isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  } finally {
    await browser?.close();
    if (worker.exitCode === null && worker.signalCode === null) {
      const ended = once(worker, 'exit');
      worker.kill();
      await ended;
    }
  }
});

test('real matching service ranks 1,000 candidates and stores history with tenant-scoped actions', {
  skip: skip || (!process.env.MATCH_AI_URL || !process.env.RESUME_REDIS_URL ? 'Configure FastAPI and Redis.' : false),
  timeout: 180_000
}, async () => {
  await seedCompanies();
  const { org } = await activate('Red Hat', []);
  const health = await fetch(process.env.MATCH_AI_URL + '/health', { signal: AbortSignal.timeout(5000) });
  assert.deepEqual(await health.json(), { status: 'ready' });
  const invalid = await fetch(process.env.MATCH_AI_URL + '/embed', { method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.MATCH_AI_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: ['synthetic-content-marker'.repeat(100)] }), signal: AbortSignal.timeout(5000) });
  assert.equal(invalid.status, 422);
  assert.deepEqual(await invalid.json(), { detail: 'Invalid embedding input' });
  const { org: foreign } = await activate('GitLab', []);
  const request = await recruitingAccount('match@fixture.example', org, 'recruiter');
  const outsider = await recruitingAccount('foreign-match@fixture.example', foreign, 'recruiter');
  const path = id => '/organizations/' + id;
  const job = await request(path(org.id) + '/jobs', { configuration: { ...newJob(), title: 'Backend API Engineer',
    description: 'Design REST APIs and distributed services', requiredSkills: [{ name: 'JavaScript' }],
    preferredSkills: [{ name: 'PostgreSQL' }], referralCount: 3 }, publish: true });
  assert.equal(job.status, 201);
  const jobId = job.data.item._id;
  const start = path(org.id) + '/matching/jobs/' + jobId + '/runs';
  const batch = new mongoose.Types.ObjectId();
  const entries = Array.from({ length: 1000 }, (_, slot) => {
    const _id = new mongoose.Types.ObjectId();
    const skills = [slot < 998 ? 'JS' : 'Java', 'Postgres'];
    const project = 'Implemented a REST API for distributed services';
    return { _id, organization: org._id, batch, slot, candidateId: _id, parsingStatus: 'parsed',
      extractedData: { skills, projects: [{ text: project }] },
      extractionEvidence: { skills: skills.map((excerpt, i) => ({ method: 'deterministic', line: i + 1, excerpt })),
        projects: [{ method: 'deterministic', line: 3, excerpt: project }] } };
  });
  const foreignId = new mongoose.Types.ObjectId();
  const unrelatedId = new mongoose.Types.ObjectId();
  const unrelatedJob = new mongoose.Types.ObjectId();
  const { MatchingRun } = await import('../server/matching/models.js');
  await Resume.insertMany([...entries, { ...entries[0], _id: foreignId, candidateId: foreignId, organization: foreign._id },
    { ...entries[0], _id: unrelatedId, candidateId: unrelatedId, job: unrelatedJob, slot: 1000 }]);
  await Candidate.insertMany([...entries.map((entry, index) => ({
    _id: entry._id, organization: org._id, name: 'Fixture Candidate ' + index, resumeIds: [entry._id],
    ...(index === 1 && { versionOf: entries[0]._id })
  })), { _id: foreignId, organization: foreign._id, name: 'Foreign fixture', resumeIds: [foreignId] },
  { _id: unrelatedId, organization: org._id, name: 'Other job fixture', resumeIds: [unrelatedId] }]);
  const mongoUrl = new URL(mongo);
  mongoUrl.pathname = '/' + mongoose.connection.name;
  const worker = spawn(process.execPath, ['server/matching/worker.js'], {
    env: { ...process.env, MONGODB_URI: mongoUrl.href }, stdio: ['ignore', 'ignore', 'inherit']
  });
  const end = once(worker, 'exit');
  try {
    const started = await request(start, {});
    assert.equal(started.status, 202, JSON.stringify(started.data));
    const runId = started.data.id;
    const route = path(org.id) + '/matching/runs/' + runId;
    assert.equal((await outsider(path(foreign.id) + '/matching/runs/' + runId)).status, 404);
    const result = await eventually(async () => {
      const { data } = await request(route);
      assert.notEqual(data.item.status, 'blocked', data.item.error);
      return data.item.status === 'completed' && data;
    }, 'Matching did not complete for 1,000 candidate records.');
    assert.equal(result.item.evaluated, 999);
    assert.equal(result.item.eligible, 997);
    assert.equal(result.results.length, 3);
    assert.match(result.item.model.revision, /^[a-f0-9]{40}$/);
    assert.ok(result.results[0].assessment.projects[0].similarity > 0.5);
    const selected = result.results.map(row => row.candidate);
    for (const [index, row] of result.results.entries()) {
      assert.equal(row.position, index);
      assert.equal(row.assessment.eligible, true);
      assert.equal(row.assessment.required[0].state, 'match');
      if (index > 0) {
        const previous = result.results[index - 1];
        assert.ok(previous.assessment.score > row.assessment.score ||
          (previous.assessment.score === row.assessment.score && previous.candidate < row.candidate));
      }
    }
    assert.equal((await request(route + '/compare', { candidates: selected.slice(0, 2) })).data.items.length, 2);
    assert.equal((await request(route + '/candidates/' + selected[0] + '/save', {})).status, 200);
    assert.equal((await request(route + '/candidates/' + selected[0] + '/approve', {})).status, 200);
    assert.ok((await request(route)).data.results[0].approvedAt);
    assert.match((await request(route + '/export')).data.toString(), /Human approval/);
    assert.equal((await request(route + '/explanations?candidate=' + entries[999]._id)).data.items[0].assessment.eligible, false);
    const changed = await request(path(org.id) + '/matching/jobs/' + jobId + '/count',
      { count: 5, revision: result.current.revision }, { method: 'PUT' });
    assert.equal(changed.status, 200);
    const rerun = await request(route + '/rerun', {});
    assert.equal(rerun.status, 202);
    const second = path(org.id) + '/matching/runs/' + rerun.data.id;
    const data = await eventually(async () => {
      const { data } = await request(second);
      assert.notEqual(data.item.status, 'blocked', data.item.error);
      return data.item.status === 'completed' && data;
    }, 'Rerun did not complete.');
    assert.equal(data.results.length, 5);
    assert.deepEqual(data.results.slice(0, 3).map(row => row.candidate), selected);
    const overview = await request(path(org.id) + '/recruiting-dashboard');
    assert.equal(overview.data.metrics.shortlistedCandidates, 5);
    assert.equal((await request(start)).data.items.length, 2);
    assert.equal((await MatchingRun.findById(runId)).snapshot.criteria.referralCount, 3);
  } finally {
    if (worker.exitCode === null && worker.signalCode === null) { worker.kill(); await end; }
  }
});

test('referrals enforce independent review, ownership and tenant isolation with durable notifications', { skip, timeout: 60000 }, async () => {
  const { MatchingRun, MatchingResult } = await import('../server/matching/models.js');
  const { Referral, Notification } = await import('../server/referrals/models.js');
  const { reconcileNotifications } = await import('../server/referrals/worker.js');
  const { deliverNotifications } = await import('../server/referrals/notifications.js');
  await seedCompanies();
  const { org } = await activate('Cloudflare', []);
  const { org: foreign } = await activate('Datadog', []);
  const employee = await recruitingAccount('owner@referrals.example', org, 'employee');
  const peer = await recruitingAccount('peer@referrals.example', org, 'employee');
  const reviewer = await recruitingAccount('reviewer@referrals.example', org, 'recruiter');
  const outsider = await recruitingAccount('foreign@referrals.example', foreign, 'recruiter');
  const reviewerUser = await User.findOne({ email: 'reviewer@referrals.example' });
  const base = '/organizations/' + org.id;
  const root = base + '/referrals';
  const job = await reviewer(base + '/jobs', { configuration: { ...newJob(), title: 'Referral Engineer', description: 'Build services' }, publish: true });
  assert.equal(job.status, 201);
  const candidate = await Candidate.create({ organization: org._id, name: 'Fixture Candidate', email: 'private@fixture.example', skills: ['SQL'] });
  const resume = await Resume.create({ organization: org._id, candidateId: candidate._id, batch: new mongoose.Types.ObjectId(), slot: 0,
    originalFilename: 'fixture.pdf', parsingStatus: 'parsed' });
  const run = await MatchingRun.create({ organization: org._id, job: job.data.item._id, createdBy: reviewerUser._id,
    status: 'completed', completedAttempt: 'fixture', shortlist: [candidate._id], snapshot: { criteria: job.data.item } });
  await MatchingResult.create({ organization: org._id, run: run._id, candidate: candidate._id, resume: resume._id,
    attempt: 'fixture', assessment: { eligible: true, score: 80, explanation: 'Fixture assessment' } });
  const profile = root + '/profiles/' + run.id + '/' + candidate.id;
  assert.equal((await employee(profile)).data.candidate.email, undefined);
  assert.equal((await reviewer(profile)).data.candidate.email, 'private@fixture.example');
  assert.equal((await employee(profile + '/original')).status, 403);
  assert.equal((await outsider('/organizations/' + foreign.id + '/referrals/profiles/' + run.id + '/' + candidate.id)).status, 404);
  const created = await employee(root, { run: run.id, candidate: candidate.id, prepare: true });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const path = root + '/' + created.data.id;
  const status = (request, next, confirmed = true) => request(path + '/status', { status: next, confirmed });
  assert.equal((await employee(root, { run: run.id, candidate: candidate.id })).status, 409);
  assert.equal((await peer(path)).status, 404);
  assert.equal((await peer(root)).data.items.length, 0);
  assert.equal((await status(employee, 'pending_review')).status, 200);
  assert.equal((await status(employee, 'approved')).status, 403);
  assert.equal((await status(reviewer, 'submitted')).status, 403);
  assert.equal((await status(reviewer, 'approved', false)).status, 400);
  const approvals = await Promise.all([status(reviewer, 'approved'), status(reviewer, 'approved')]);
  assert.ok(approvals.every(result => result.status === 200));
  assert.equal((await Referral.findById(created.data.id)).history.filter(row => row.status === 'approved').length, 1);
  assert.match((await reviewer(path + '/export')).data.toString(), /Fixture Candidate/);
  assert.equal((await employee(path + '/export')).status, 403);
  assert.equal((await status(reviewer, 'submitted')).status, 200);
  assert.equal((await status(reviewer, 'completed')).status, 200);
  assert.equal((await employee(path)).data.item.history.length, 5);
  await reconcileNotifications();
  await reconcileNotifications();
  const notices = await employee(root + '/notifications');
  assert.equal(notices.data.unread, 4);
  const notice = notices.data.items[0]._id;
  assert.equal((await peer(root + '/notifications/' + notice + '/read', {})).status, 404);
  assert.equal((await employee(root + '/notifications/' + notice + '/read', {})).status, 204);
  assert.equal((await employee(root + '/notifications')).data.unread, 3);
  const batch = await (await import('../server/resumes/models.js')).UploadBatch.create({
    organization: org._id, createdBy: reviewerUser._id, files: [{ name: 'retry-fixture.pdf', size: 12 }]
  });
  const retried = await Resume.create({ organization: org._id, batch: batch._id, slot: 0, parsingStatus: 'failed' });
  await reconcileNotifications();
  await Resume.updateOne({ _id: retried._id }, { $inc: { generation: 1 } });
  await reconcileNotifications();
  assert.equal(await Notification.countDocuments({ organization: org._id,
    key: { $in: ['resume-' + retried.id + '-0-failed', 'resume-' + retried.id + '-1-failed'] } }), 2);
  await employee(root + '/notifications/preferences', { email: true }, { method: 'PUT' });
  let rejected = 0;
  await deliverNotifications(config, { async send() { rejected++; throw new Error('Provider rejected'); } });
  const mail = await Notification.findById(notice);
  assert.equal(mail.delivery, 'pending');
  assert.ok(rejected > 0);
  const stats = await reviewer(root + '/analytics?job=' + job.data.item._id);
  assert.equal(stats.data.requests, 1);
  assert.equal(stats.data.distribution.completed, 1);
  assert.equal(stats.data.conversion, 1);
  assert.equal((await employee(root + '/analytics')).status, 403);
  const reviewAdmin = await recruitingAccount('admin@referrals.example', org, 'company_admin');
  const another = await reviewer(root, { run: run.id, candidate: candidate.id });
  assert.equal(another.status, 201);
  const nextPath = root + '/' + another.data.id + '/status';
  assert.equal((await reviewer(nextPath, { status: 'approved', confirmed: true })).status, 403);
  assert.equal((await reviewAdmin(nextPath, { status: 'rejected', confirmed: true, comment: 'Fixture review' })).status, 200);
  if (process.env.BROWSER_CHANNEL || process.env.BROWSER_EXECUTABLE) {
    const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined,
      executablePath: process.env.BROWSER_EXECUTABLE || undefined });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.goto(config.origin + '/dashboard/' + org.id + '/candidate/' + run.id + '/' + candidate.id);
      await page.getByLabel('Work email').fill('owner@referrals.example');
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Fixture Candidate' }).waitFor({ timeout: 8000 }).catch(async error => {
        throw new Error('Candidate page unavailable at ' + new URL(page.url()).pathname + ': ' + (await page.locator('main').innerText()).slice(0, 400), { cause: error });
      });
      await page.getByRole('button', { name: 'Create referral request' }).click();
      await page.getByRole('heading', { name: 'Status history' }).waitFor();
      await page.getByRole('link', { name: /Notifications/ }).click();
      await page.getByRole('heading', { name: 'Notifications' }).waitFor();
      await page.getByRole('button', { name: 'Mark read' }).first().click();
    } finally { await browser.close(); }
  }
});
