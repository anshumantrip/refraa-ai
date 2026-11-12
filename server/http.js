import { Rate } from './models.js';
import { digest } from './security.js';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const fail = (status, message, code) => { throw new HttpError(status, message, code); };
export const isDuplicate = (error) => error?.code === 11000;

export function read(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) fail(400, result.error.issues[0].message, 'INVALID_INPUT');
  return result.data;
}

export async function rateLimit(config, scope, value, limit, windowMs) {
  const now = Date.now();
  const expiresAt = new Date((Math.floor(now / windowMs) + 1) * windowMs);
  const _id = digest(config.secret, 'rate:' + scope, value + ':' + expiresAt.getTime());
  let bucket;
  try {
    bucket = await Rate.findOneAndUpdate({ _id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: false });
  } catch (error) {
    if (!isDuplicate(error)) throw error;
    bucket = await Rate.findOneAndUpdate({ _id }, { $inc: { count: 1 } }, { returnDocument: 'after' });
  }
  if (!bucket || bucket.count > limit) fail(429, 'Too many requests. Please wait and try again.', 'RATE_LIMIT');
}
