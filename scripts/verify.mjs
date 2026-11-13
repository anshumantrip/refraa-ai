import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { stripVTControlCharacters } from 'node:util';

function limit(key, fallback, min, max) {
  const value = Number(process.env[key] || fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error('Invalid ' + key);
  return value;
}
const maxIterations = limit('VERIFY_ITERATIONS', 20, 1, 20);
const maxAttempts = limit('VERIFY_ATTEMPTS', 5, 1, 5);
const budget = limit('VERIFY_SECONDS', 360, 5, 1800) * 1000;
const commandLimit = limit('VERIFY_CHECK_SECONDS', 240, 5, 900) * 1000;
const startedAt = new Date();
const deadline = +startedAt + budget;
const npm = (args) => process.platform === 'win32' ?
  ['cmd.exe', ['/d', '/s', '/c', 'npm.cmd ' + args.join(' ')]] : ['npm', args];
const checks = [
  ['dependencies', npm(['ls', '--all', '--json'])], ['lint', npm(['run', 'lint'])],
  ['unit', npm(['test'])], ['build', npm(['run', 'build'])],
  ['integration', npm(['run', 'test:integration'])],
  ['npm-audit', npm(['audit', '--omit=dev', '--json', '--fetch-retries=0'])],
  ['docker-daemon', ['docker', ['info', '--format', '{{.ServerVersion}}']]],
  ['docker-api', ['docker', ['build', '--quiet', '.']]],
  ['docker-ai', ['docker', ['build', '--quiet', 'ai']]]
];
const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 3000 });
const history = [];
const directory = 'database/verification_runs';
await mkdir(directory, { recursive: true });
const previousFile = (await readdir(directory)).filter(name => name.endsWith('.json')).sort().at(-1);
const previous = previousFile ? JSON.parse(await readFile(directory + '/' + previousFile, 'utf8')).history : [];

function terminate(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', timeout: 4000 });
      if (result.status !== 0) child.kill();
    } else process.kill(-child.pid, 'SIGKILL');
  } catch { child.kill(); }
}

function execute([command, args], timeout) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      windowsHide: true, env: process.env });
    let output = '';
    let timedOut = false;
    const add = bytes => { output = (output + bytes.toString()).slice(-64_000); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const timer = setTimeout(() => { timedOut = true; terminate(child); }, timeout);
    child.once('error', error => { clearTimeout(timer); resolve({ code: null, output, error: error.code }); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, output, timedOut }); });
  });
}

function classify(name, result) {
  const output = result.output;
  if (result.timedOut) return ['BLOCKED', 'Command exceeded its time budget'];
  if (result.error === 'ENOENT') return ['BLOCKED', 'Required executable unavailable'];
  if (name === 'docker-daemon' && result.code !== 0) return ['BLOCKED', 'Docker daemon unavailable'];
  if (name === 'npm-audit' && result.code !== 0 && /ENOTFOUND|EAI_AGAIN|ECONN|audit endpoint|fetch failed/i.test(output)) {
    return ['BLOCKED', 'Advisory registry unavailable'];
  }
  if (name === 'integration' && result.code === 0 && /(?:^|\n).*skipped\s+[1-9]/i.test(output)) {
    return ['BLOCKED', 'Some integration tests were skipped'];
  }
  return result.code === 0 ? ['PASS', 'Command completed'] : ['FAIL', 'Command exited unsuccessfully'];
}

for (const [name, command] of checks) {
  if (['docker-api', 'docker-ai'].includes(name) && history.findLast(row => row.check === 'docker-daemon')?.status !== 'PASS') {
    history.push({ check: name, status: 'BLOCKED', reason: 'Docker daemon unavailable' });
    console.log(name + ' BLOCKED (Docker daemon unavailable)');
    continue;
  }
  const seen = new Set();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (history.filter(row => row.attempt).length >= maxIterations || deadline - Date.now() < 1000) {
      history.push({ check: name, status: 'BLOCKED', reason: 'Verification budget exhausted' });
      break;
    }
    const started = Date.now();
    const result = await execute(command, Math.min(deadline - started, commandLimit));
    const [status, reason] = classify(name, result);
    // Persist a fingerprint and aggregate counts. Command output can contain fixture data or secrets.
    const normalized = stripVTControlCharacters(result.output).replace(/\b[0-9a-f]{24,}\b/gi, '#')
      .replace(/\(\d+(?:\.\d+)?ms\)/g, '(duration)').replace(/\d+(?:\.\d+)?ms/g, 'duration')
      .split('\n').filter(line => !/duration|^npm notice/.test(line)).join('\n');
    const fingerprint = createHash('sha256').update(normalized + result.code).digest('hex').slice(0, 16);
    const repeated = seen.has(fingerprint);
    seen.add(fingerprint);
    const counts = Object.fromEntries([...result.output.matchAll(/(?:^|\n)(?:ℹ|#)\s*(pass|fail|skipped)\s+(\d+)/g)]
      .map(([, key, value]) => [key, Number(value)]));
    const cases = [...result.output.matchAll(/^([✔✖﹣]) (.+?)(?: \((\d+(?:\.\d+)?)ms\)| \u0023 .*)?$/gm)]
      .map(([, mark, title, elapsed]) => ({ title, status: mark === '✔' ? 'PASS' : mark === '✖' ? 'FAIL' : 'BLOCKED',
        ...(elapsed && { elapsedMs: Number(elapsed) }) }))
      .filter(row => row.status === 'PASS');
    const prior = previous.findLast(row => row.check === name);
    const regression = prior?.status === 'PASS' && status === 'FAIL';
    const recurring = status === 'FAIL' && previous.some(row => row.check === name && row.status === 'FAIL' &&
      row.fingerprint === fingerprint);
    history.push({ check: name, attempt, status, reason, elapsedMs: Date.now() - started,
      exitCode: result.code, fingerprint, repeated, regression, recurring, ...counts, ...(cases.length && { passedCases: cases }) });
    console.log(name + ' ' + status + ' (' + reason + ')');
    if (status !== 'FAIL' || repeated) break;
  }
}
const report = { startedAt: startedAt.toISOString(), checkpoint: git.status === 0 ? git.stdout.trim() : null,
  maxAttempts, maxIterations, budget, history };
const filename = directory + '/' + startedAt.toISOString().replace(/[:.]/g, '-') + '.json';
await writeFile(filename, JSON.stringify(report, null, 2) + '\n');
console.log(filename);
const final = [...new Map(history.map(row => [row.check, row])).values()];
process.exitCode = final.some(row => row.status === 'FAIL') ? 1 : final.some(row => row.status === 'BLOCKED') ? 2 : 0;
