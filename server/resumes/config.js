export function resumeConfig(env = process.env) {
  const integer = (key, fallback, min, max) => {
    const value = Number(env[key] || fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid ' + key);
    return value;
  };
  const accessKeyId = env.RESUME_S3_ACCESS_KEY;
  const secretAccessKey = env.RESUME_S3_SECRET_KEY;
  if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) throw new Error('Configure both resume storage keys.');
  const endpoint = env.RESUME_S3_ENDPOINT;
  if (endpoint && (env.NODE_ENV === 'production' ? !endpoint.startsWith('https://') : !/^https?:\/\//.test(endpoint))) {
    throw new Error('Invalid resume storage endpoint. Production requires HTTPS.');
  }
  return {
    bucket: env.RESUME_S3_BUCKET, endpoint, region: env.RESUME_S3_REGION || 'us-east-1',
    credentials: accessKeyId ? { accessKeyId, secretAccessKey } : undefined,
    pathStyle: env.RESUME_S3_PATH_STYLE === 'true',
    redisUrl: env.RESUME_REDIS_URL, queue: env.RESUME_QUEUE_NAME || 'refraa-resumes',
    maxFile: integer('RESUME_FILE_MB', 10, 1, 25) * 1024 ** 2,
    maxBatch: integer('RESUME_BATCH_MB', 4096, 1, 25000) * 1024 ** 2,
    uploads: integer('RESUME_UPLOAD_CONCURRENCY', 8, 1, 16),
    concurrency: integer('RESUME_WORKER_CONCURRENCY', 3, 1, 12),
    attempts: integer('RESUME_WORKER_ATTEMPTS', 4, 1, 8),
    retentionDays: integer('RESUME_RETENTION_DAYS', 0, 0, 3650),
    clamHost: env.RESUME_CLAMAV_HOST, clamPort: integer('RESUME_CLAMAV_PORT', 3310, 1, 65535),
    requireScan: env.RESUME_REQUIRE_SCAN === 'true'
  };
}
