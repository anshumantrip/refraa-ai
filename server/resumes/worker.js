import mongoose from 'mongoose';
import { Worker } from 'bullmq';
import { ensureIndexes } from '../models.js';
import './models.js';
import { resumeConfig } from './config.js';
import { resumeStorage } from './storage.js';
import { createResumeQueue, redisOptions } from './queue.js';
import { resumeProcessor } from './processor.js';
import { maintainResumes } from './maintenance.js';

let queue, worker, timer, running;
async function shutdown() {
  clearInterval(timer);
  await worker?.close();
  await running;
  await queue?.close();
  await mongoose.disconnect();
}

try {
  const config = resumeConfig();
  const storage = resumeStorage(config);
  if (!process.env.MONGODB_URI || !storage || !config.redisUrl || (config.requireScan && !config.clamHost)) {
    throw new Error('Set MongoDB, private resume storage, Redis, and any required malware scanner.');
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await ensureIndexes();
  queue = createResumeQueue(config, true);
  worker = new Worker(config.queue, resumeProcessor(config, storage), {
    connection: redisOptions(config.redisUrl, true), concurrency: config.concurrency, maxStalledCount: 2, autorun: false
  });
  let lastErrorAt = 0;
  worker.on('error', error => {
    if (Date.now() - lastErrorAt < 5000) return;
    lastErrorAt = Date.now();
    console.error('Resume worker error:', error.name);
  });
  await worker.waitUntilReady();
  void worker.run().catch(error => {
    console.error('Resume worker stopped:', error.name);
    process.exitCode = 1;
    return shutdown();
  });
  const tick = () => {
    if (!running) running = maintainResumes(config, queue, storage)
      .catch(error => console.error('Resume maintenance error:', error.name)).finally(() => { running = null; });
  };
  timer = setInterval(tick, 15_000);
  tick();
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void shutdown(); });
} catch (error) {
  console.error('Resume worker startup failed:', error.name === 'Error' ? error.message : error.name);
  await shutdown();
  process.exitCode = 1;
}
