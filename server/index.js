import mongoose from 'mongoose';
import { loadConfig } from './config.js';
import { ensureIndexes } from './models.js';
import { createApp } from './app.js';

try {
  const config = loadConfig();
  await mongoose.connect(config.mongo, { serverSelectionTimeoutMS: 5000 });
  await ensureIndexes();
  const server = createApp(config).listen(config.port, () => console.log('refraaAI API listening on port ' + config.port));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(async () => { await mongoose.disconnect(); }));
  }
} catch (error) {
  console.error('Startup failed:', error.name === 'Error' ? error.message : error.name);
  await mongoose.disconnect();
  process.exitCode = 1;
}
