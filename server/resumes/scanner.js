import { connect } from 'node:net';
import { DocumentError } from './errors.js';

export async function scanResume(bytes, config) {
  if (!config.clamHost) {
    if (config.requireScan) throw new Error('Malware scanner is not configured.');
    return;
  }
  const result = await new Promise((resolve, reject) => {
    const socket = connect({ host: config.clamHost, port: config.clamPort });
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    let output = '';
    socket.setTimeout(20_000, () => socket.destroy(new Error('Scanner timeout.')));
    socket.on('error', reject);
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      socket.write(length);
      socket.write(bytes);
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', chunk => {
      output += chunk.toString('utf8');
      if (output.length > 4096) socket.destroy(new Error('Invalid scanner response.'));
      else if (output.includes('\0') || output.includes('\n')) { socket.destroy(); resolve(output.trim()); }
    });
    socket.on('end', () => resolve(output.trim()));
    socket.on('close', () => reject(new Error('Scanner closed the connection.')));
  });
  if (/ FOUND[\s\0]*$/.test(result)) throw new DocumentError('The malware scanner rejected this file.');
  if (!/^stream: OK[\s\0]*$/.test(result)) throw new Error('Malware scan did not complete.');
}
