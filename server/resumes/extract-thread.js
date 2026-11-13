import { parentPort, workerData } from 'node:worker_threads';
import { extractText } from './file.js';
import { parseResume } from './parse.js';
import { DocumentError } from './errors.js';

try {
  const text = await extractText(Buffer.from(workerData.bytes), workerData.mime);
  parentPort.postMessage({ text, ...parseResume(text) });
} catch (error) {
  parentPort.postMessage(error instanceof DocumentError ? { error: error.message, status: error.status } :
    { error: 'Document could not be extracted.', status: 'failed' });
}
