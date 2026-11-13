import { Queue } from 'bullmq';

export function redisOptions(value, worker = false) {
  const url = new URL(value);
  if (!['redis:', 'rediss:'].includes(url.protocol) || (url.pathname && !/^\/(?:\d+)?$/.test(url.pathname))) {
    throw new Error('Invalid RESUME_REDIS_URL.');
  }
  return { host: url.hostname, port: Number(url.port || 6379), db: Number(url.pathname.slice(1) || 0),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    ...(url.protocol === 'rediss:' && { tls: {} }),
    maxRetriesPerRequest: worker ? null : 1, enableOfflineQueue: worker, connectTimeout: 5000 };
}

export function createResumeQueue(config, worker = false) {
  const queue = new Queue(config.queue, { connection: redisOptions(config.redisUrl, worker) });
  queue.on('error', error => console.error('Resume queue connection error:', error.name));
  return queue;
}

export const queueId = resume => String(resume._id) + '-' + resume.generation;
export const enqueue = (queue, config, resume) => queue.add('extract', {
  id: String(resume._id), organization: String(resume.organization), generation: resume.generation
}, {
  jobId: queueId(resume), attempts: config.attempts, backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 86400, count: 10000 }, removeOnFail: { age: 604800, count: 20000 }
});
