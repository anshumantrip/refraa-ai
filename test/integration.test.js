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

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
});

function client(options = config) {
  const jar = new Map();
  let csrf;
  return async (path, body, overrides = {}) => {
    const method = overrides.method || (body === undefined ? 'GET' : 'POST');
    if (method === 'POST' && !csrf && overrides.csrf !== false) {
      const response = await fetch(options.origin + '/api/auth/csrf');
      csrf = (await response.json()).csrf;
      jar.set('refraa_csrf', response.headers.getSetCookie()[0].split(';')[0]);
    }
    const response = await fetch(options.origin + '/api' + path, {
      method,
      headers: {
        Cookie: [...jar.values()].join('; '),
        Origin: overrides.origin || options.origin,
        ...(method === 'POST' && { 'Content-Type': 'application/json' }),
        ...(csrf && overrides.csrf !== false && { 'X-CSRF-Token': csrf })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    for (const cookie of response.headers.getSetCookie()) jar.set(cookie.split('=')[0], cookie.split(';')[0]);
    return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: response.headers };
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
