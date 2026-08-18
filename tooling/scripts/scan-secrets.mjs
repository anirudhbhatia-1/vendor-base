import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedEnvironmentExamples = new Set(['.env.example', '.env.test.example']);
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g],
  ['Stripe secret key', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['npm access token', /\bnpm_[A-Za-z0-9]{36}\b/g],
];

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

export function scanText(file, text) {
  const findings = [];
  const basename = path.basename(file);
  if (/^\.env(?:\..+)?$/.test(basename) && !allowedEnvironmentExamples.has(basename)) {
    findings.push({ file, line: 1, kind: 'committed environment file' });
  }
  for (const [kind, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push({ file, line: lineNumber(text, match.index), kind });
    }
  }
  return findings;
}

function repositoryFiles() {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(result.stderr || 'git ls-files failed');
  return result.stdout.split('\0').filter(Boolean);
}

function runSelfTest() {
  const githubToken = `ghp_${'A'.repeat(32)}`;
  const awsKey = `AKIA${'B'.repeat(16)}`;
  if (scanText('fixture.txt', `${githubToken}\n${awsKey}`).length !== 2) {
    throw new Error('known secret shapes were not detected');
  }
  if (scanText('.env.example', 'TOKEN=PLACEHOLDER_ONLY').length !== 0) {
    throw new Error('safe environment example was rejected');
  }
  if (scanText('.env.local', 'TOKEN=PLACEHOLDER_ONLY').length !== 1) {
    throw new Error('committed environment file was not rejected');
  }
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    console.warn('Secret-scanner self-test passed.');
    return;
  }

  const findings = [];
  for (const file of repositoryFiles()) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 2_000_000) continue;
    const content = fs.readFileSync(file);
    if (content.includes(0)) continue;
    findings.push(...scanText(file, content.toString('utf8')));
  }
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line}: possible ${finding.kind}`);
    }
    process.exitCode = 1;
    return;
  }
  console.warn('Secret scan passed.');
}

main();
