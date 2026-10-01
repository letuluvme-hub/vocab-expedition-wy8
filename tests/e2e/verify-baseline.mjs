import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const artifacts = path.join(root, 'tests/e2e/artifacts');
const cli = path.join(root, 'node_modules/@playwright/test/cli.js');
const fixture = path.join(root, 'tests/fixtures/legacy.html');
mkdirSync(artifacts, { recursive: true });
const checksum = () => createHash('sha256').update(readFileSync(fixture)).digest('hex');
const originalChecksum = checksum();
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({ executablePath: existsSync(chrome) ? chrome : undefined, args: ['--mute-audio'] });
const browserVersion = browser.version();
await browser.close();
const reports = [];

function run(name, args, mutation, expectedFailure) {
  const result = spawnSync(process.execPath, [cli, 'test', '--output', path.join(artifacts, `${name}-test-results`), ...args], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, E2E_MUTATION: mutation || '' },
  });
  const output = (result.stdout || '') + (result.stderr || '');
  process.stdout.write(`\n=== ${name} ===\n${output}`);
  writeFileSync(path.join(artifacts, `${name}.log`), output);
  const raw = readFileSync(path.join(artifacts, 'results.json'), 'utf8');
  writeFileSync(path.join(artifacts, `${name}.json`), raw);
  const stats = JSON.parse(raw).stats;
  const valid = expectedFailure
    ? result.status === 1 && stats.unexpected === 1 && expectedFailure.test(output)
    : result.status === 0 && stats.unexpected === 0 && stats.expected > 0;
  const report = { name, status: result.status, passed: stats.expected, failed: stats.unexpected,
    skipped: stats.skipped, durationMs: stats.duration, intendedOutcomeVerified: valid };
  reports.push(report);
  if (!valid) throw new Error(`Unexpected outcome from ${name}; see artifacts/${name}.log`);
}

run('legacy-baseline', ['--project=legacy']);
run('new-regression', ['--project=new']);
run('mutation-partial-mastery', ['--project=legacy', '--grep', 'partial word kill'],
  'partial-mastery', /Received array:\s+\["litre"\]/);
run('mutation-duplicate-mastery', ['--project=legacy', '--grep', 'complete phrase'],
  'duplicate-mastery', /Received length: 2/);
if (checksum() !== originalChecksum) throw new Error('Archive was unexpectedly modified');
const verification = { browser: { engine: 'Chromium', version: browserVersion,
  executablePath: existsSync(chrome) ? chrome : 'Playwright Chromium' },
  fixtureSha256: originalChecksum, fixtureUnchanged: true, reports };
writeFileSync(path.join(artifacts, 'verification.json'), JSON.stringify(verification, null, 2));
console.log('\nVerification:', JSON.stringify(verification, null, 2));
