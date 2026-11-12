export function loadConfig(env = process.env) {
  const { AUTH_SECRET: secret, MONGODB_URI: mongo, APP_ORIGIN: rawOrigin } = env;
  if (!secret || secret.length < 32) throw new Error('Set AUTH_SECRET to a random secret of at least 32 characters.');
  if (!mongo) throw new Error('Set MONGODB_URI.');
  if (!rawOrigin) throw new Error('Set APP_ORIGIN to the browser origin.');
  const origin = new URL(rawOrigin);
  const production = env.NODE_ENV === 'production';
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== rawOrigin ||
      (production && origin.protocol !== 'https:')) throw new Error('APP_ORIGIN must be a bare origin using HTTPS in production.');
  const port = Number(env.PORT || 3000);
  const proxy = Number(env.TRUST_PROXY_HOPS || 0);
  const smtpPort = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(proxy) || proxy < 0 ||
      !Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error('Invalid port or proxy configuration.');
  return {
    secret, mongo, origin: origin.origin, production, port, proxy,
    mail: { host: env.SMTP_HOST, port: smtpPort, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM }
  };
}
