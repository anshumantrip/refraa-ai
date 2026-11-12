import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User, Session } from './models.js';
import { fail, HttpError, isDuplicate, rateLimit, read } from './http.js';
import { credentials, emailOnly, register, reset, verify } from './validation.js';
import {
  cookies, cookiePolicy, csrfValid, digest, otp, otpOutcome, token,
  OTP_TTL, OTP_ATTEMPTS, RESEND_MS, SESSION_TTL, RESET_TTL
} from './security.js';

const workFactor = 12;
const dummyPassword = bcrypt.hash(token(), workFactor);
const publicUser = ({ id, name, email, verifiedAt, systemRole }) => ({ id, name, email, verifiedAt, systemRole });

export function sessionSecurity(config) {
  const { prefix, ...options } = cookiePolicy(config);
  const sessionKey = prefix + 'refraa_session';
  const csrfKey = prefix + 'refraa_csrf';
  const sessionHash = (value) => digest(config.secret, 'session', value);
  return {
    csrf(req, res, next) {
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      if (!csrfValid(config, cookies(req.headers.cookie)[csrfKey], req.get('X-CSRF-Token'), req.get('Origin'))) {
        return next(new HttpError(403, 'Session check failed. Refresh the page and try again.', 'CSRF'));
      }
      next();
    },
    issueCsrf(req, res) {
      let csrf = cookies(req.headers.cookie)[csrfKey];
      if (!csrfValid(config, csrf, csrf, config.origin)) {
        const nonce = token();
        csrf = nonce + '.' + digest(config.secret, 'csrf', nonce);
      }
      res.cookie(csrfKey, csrf, { ...options, maxAge: SESSION_TTL });
      res.json({ csrf });
    },
    async requireUser(req, res, next) {
      const raw = cookies(req.headers.cookie)[sessionKey];
      const session = raw && await Session.findOne({ hash: sessionHash(raw), expiresAt: { $gt: new Date() } });
      const user = session && await User.findOne({ _id: session.user, sessionVersion: session.version, verifiedAt: { $ne: null } });
      if (!user?.verifiedAt) fail(401, 'Sign in to continue.', 'AUTH_REQUIRED');
      req.user = user;
      next();
    },
    async login(req, res, user) {
      const old = cookies(req.headers.cookie)[sessionKey];
      if (old) await Session.deleteOne({ hash: sessionHash(old) });
      const raw = token();
      await Session.create({ hash: sessionHash(raw), user: user.id, version: user.sessionVersion,
        expiresAt: new Date(Date.now() + SESSION_TTL) });
      res.cookie(sessionKey, raw, { ...options, maxAge: SESSION_TTL });
    },
    async logout(req, res) {
      const raw = cookies(req.headers.cookie)[sessionKey];
      if (raw) await Session.deleteOne({ hash: sessionHash(raw) });
      res.clearCookie(sessionKey, options);
    }
  };
}

export function authRoutes(config, mailer, security) {
  const routes = Router();
  const otpHash = (email, code) => digest(config.secret, 'email:' + email, code);
  const resetHash = (value) => digest(config.secret, 'reset', value);

  async function sendVerification(user) {
    const code = otp();
    const now = Date.now();
    const verification = { hash: otpHash(user.email, code), expiresAt: now + OTP_TTL,
      nextSendAt: now + RESEND_MS, attempts: 0 };
    const issued = await User.updateOne({ _id: user.id, verifiedAt: null, $or: [
      { 'verification.nextSendAt': { $exists: false } }, { 'verification.nextSendAt': { $lte: now } }
    ] }, { $set: { verification } });
    if (!issued.modifiedCount) fail(429, 'Wait 45 seconds before requesting a new code.', 'OTP_COOLDOWN');
    await mailer.send(user.email, 'Verify your refraaAI work email',
      'Your verification code is ' + code + '. It expires in 10 minutes.');
  }

  async function limit(req, scope, key, max, windowMs = 15 * 60_000) {
    await rateLimit(config, scope + ':ip', req.ip, max * 5, windowMs);
    if (key) await rateLimit(config, scope + ':account', key, max, windowMs);
  }

  routes.get('/csrf', security.issueCsrf);
  routes.get('/me', security.requireUser, (req, res) => res.json({ user: publicUser(req.user) }));
  routes.post('/register', async (req, res) => {
    const { name, email, password } = read(register, req.body);
    await limit(req, 'register', email, 5);
    mailer.requireDelivery();
    let user;
    try { user = await User.create({ name, email, password: await bcrypt.hash(password, workFactor) }); }
    catch (error) {
      if (isDuplicate(error)) fail(409, 'An account already uses this email. Sign in or request a new verification code.', 'EMAIL_EXISTS');
      throw error;
    }
    await sendVerification(user);
    res.status(201).json({ email, resendAfter: RESEND_MS / 1000 });
  });

  routes.post('/resend', async (req, res) => {
    const { email } = read(emailOnly, req.body);
    await limit(req, 'resend', email, 6);
    mailer.requireDelivery();
    const user = await User.findOne({ email, verifiedAt: null });
    if (user) await sendVerification(user);
    res.json({ message: 'If the account needs verification, a new code was sent.', resendAfter: RESEND_MS / 1000 });
  });

  routes.post('/verify', async (req, res) => {
    const { email, code, password } = read(verify, req.body);
    await limit(req, 'verify', email, 20);
    const user = await User.findOne({ email, verifiedAt: null }).select('+verification +password');
    const passwordMatches = await bcrypt.compare(password, user?.password || await dummyPassword);
    const now = Date.now();
    const outcome = otpOutcome(user?.verification, otpHash(email, code), now);
    if (outcome === 'closed') fail(400, 'This code is no longer usable. Request a new code.', 'OTP_CLOSED');
    const filter = { _id: user.id, verifiedAt: null, password: user.password, 'verification.hash': user.verification.hash,
      'verification.expiresAt': { $gt: now }, 'verification.attempts': { $lt: OTP_ATTEMPTS } };
    if (outcome === 'incorrect' || !passwordMatches) {
      await User.updateOne(filter, { $inc: { 'verification.attempts': 1 } });
      fail(400, 'The code or password is incorrect.', 'OTP_INCORRECT');
    }
    const result = await User.updateOne(filter, { $set: { verifiedAt: new Date() }, $unset: { verification: 1 } });
    if (!result.modifiedCount) fail(400, 'This code is no longer usable. Request a new code.', 'OTP_CLOSED');
    res.json({ message: 'Email verified. You can sign in.' });
  });

  routes.post('/login', async (req, res) => {
    const { email, password } = read(credentials, req.body);
    await limit(req, 'login', email, 12);
    const user = await User.findOne({ email }).select('+password');
    const valid = await bcrypt.compare(password, user?.password || await dummyPassword);
    if (!user || !valid) fail(401, 'The email or password is incorrect.', 'BAD_CREDENTIALS');
    if (!user.verifiedAt) fail(403, 'Verify your work email before signing in.', 'EMAIL_UNVERIFIED');
    await security.login(req, res, user);
    res.json({ user: publicUser(user) });
  });

  routes.post('/logout', async (req, res) => {
    await security.logout(req, res);
    res.status(204).end();
  });

  routes.post('/forgot', async (req, res) => {
    const { email } = read(emailOnly, req.body);
    await limit(req, 'forgot', email, 5);
    mailer.requireDelivery();
    const now = Date.now();
    const raw = token();
    const user = await User.findOneAndUpdate({ email, $or: [
      { 'reset.nextSendAt': { $exists: false } }, { 'reset.nextSendAt': { $lte: now } }
    ] }, { $set: { reset: { hash: resetHash(raw), expiresAt: now + RESET_TTL, nextSendAt: now + RESEND_MS } } });
    if (user) {
      // Keep the credential out of request URLs and server access logs.
      await mailer.send(email, 'Reset your refraaAI password',
        'Reset your password within 30 minutes: ' + config.origin + '/reset#token=' + raw);
    }
    res.json({ message: 'If an account exists, a reset link was sent.' });
  });

  routes.post('/reset', async (req, res) => {
    const { token: raw, password } = read(reset, req.body);
    await limit(req, 'reset', null, 5);
    const hash = resetHash(raw);
    const user = await User.findOne({ 'reset.hash': hash, 'reset.expiresAt': { $gt: Date.now() } });
    if (!user) fail(400, 'This reset link is invalid or expired.', 'RESET_INVALID');
    const result = await User.updateOne({ _id: user.id, 'reset.hash': hash, 'reset.expiresAt': { $gt: Date.now() } }, {
      $set: { password: await bcrypt.hash(password, workFactor) },
      $unset: { reset: 1 }, $inc: { sessionVersion: 1 }
    });
    if (!result.modifiedCount) fail(400, 'This reset link is invalid or expired.', 'RESET_INVALID');
    res.json({ message: 'Password changed. Sign in with your new password.' });
  });
  return routes;
}
