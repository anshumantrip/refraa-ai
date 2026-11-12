import nodemailer from 'nodemailer';
import { fail } from './http.js';

export function createMailer(config) {
  const { host, port, user, pass, from } = config.mail;
  const ready = Boolean(host && user && pass && from);
  const transport = ready && nodemailer.createTransport({
    host, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user, pass }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000
  });
  function requireDelivery() {
    if (!ready) fail(503, 'Email delivery is not configured. Contact the service operator.', 'EMAIL_NOT_CONFIGURED');
  }
  return {
    requireDelivery,
    async send(to, subject, text) {
      requireDelivery();
      try {
        const info = await transport.sendMail({ from, to, subject, text });
        if (!info.accepted?.length) throw new Error('Recipient rejected.');
      } catch {
        fail(503, 'Email could not be delivered. Please try again later.', 'EMAIL_DELIVERY_FAILED');
      }
    }
  };
}
